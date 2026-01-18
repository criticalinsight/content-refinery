var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/ContentDO.ts
import { DurableObject } from "cloudflare:workers";
var ContentDO = class extends DurableObject {
  static {
    __name(this, "ContentDO");
  }
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.getWebSockets().forEach((ws) => {
    });
    this.initDatabase();
  }
  initDatabase() {
    this.ctx.storage.sql.exec(`
            CREATE TABLE IF NOT EXISTS channels (
                id TEXT PRIMARY KEY,
                name TEXT,
                config JSON,
                created_at INTEGER,
                success_count INTEGER DEFAULT 0,
                failure_count INTEGER DEFAULT 0,
                last_ingested_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS content_items (
                id TEXT PRIMARY KEY,
                source_id TEXT,
                source_name TEXT,
                raw_text TEXT,
                processed_json JSON,
                sentiment TEXT,
                is_signal INTEGER DEFAULT 0,
                retry_count INTEGER DEFAULT 0,
                synced_to_graph INTEGER DEFAULT 0,
                last_error TEXT,
                created_at INTEGER
            );
        `);
    try {
      this.ctx.storage.sql.exec(`ALTER TABLE channels ADD COLUMN success_count INTEGER DEFAULT 0`);
    } catch (e) {
    }
    try {
      this.ctx.storage.sql.exec(`ALTER TABLE channels ADD COLUMN failure_count INTEGER DEFAULT 0`);
    } catch (e) {
    }
    try {
      this.ctx.storage.sql.exec(`ALTER TABLE channels ADD COLUMN last_ingested_at INTEGER`);
    } catch (e) {
    }
    try {
      this.ctx.storage.sql.exec(`ALTER TABLE content_items ADD COLUMN retry_count INTEGER DEFAULT 0`);
    } catch (e) {
    }
    try {
      this.ctx.storage.sql.exec(`ALTER TABLE content_items ADD COLUMN last_error TEXT`);
    } catch (e) {
    }
    try {
      this.ctx.storage.sql.exec(`ALTER TABLE content_items ADD COLUMN synced_to_graph INTEGER DEFAULT 0`);
    } catch (e) {
    }
  }
  // Generic retry helper for external fetch
  async fetchWithRetry(url, options, maxRetries = 3) {
    let lastError = null;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3e4);
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) return res;
        if (res.status === 429 || res.status >= 500) throw new Error(`Server error: ${res.status}`);
        return res;
      } catch (e) {
        lastError = e;
        const delay = 1e3 * Math.pow(2, i);
        console.warn(`[ContentRefinery] Retry ${i + 1}/${maxRetries} to ${url} after ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastError || new Error("Fetch failed");
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ status: "healthy", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
    }
    if (url.pathname === "/stats" && request.method === "GET") {
      const totalItems = this.ctx.storage.sql.exec("SELECT COUNT(*) as cnt FROM content_items").toArray()[0];
      const signalCount = this.ctx.storage.sql.exec("SELECT COUNT(*) as cnt FROM content_items WHERE is_signal = 1").toArray()[0];
      const processedCount = this.ctx.storage.sql.exec("SELECT COUNT(*) as cnt FROM content_items WHERE processed_json IS NOT NULL").toArray()[0];
      return Response.json({
        totalItems: totalItems?.cnt || 0,
        processedItems: processedCount?.cnt || 0,
        signals: signalCount?.cnt || 0,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    if (url.pathname === "/ingest" && request.method === "POST") {
      return this.handleIngest(request);
    }
    if (url.pathname === "/process" && request.method === "POST") {
      await this.processBatch();
      return Response.json({ success: true });
    }
    if (url.pathname === "/sql" && request.method === "POST") {
      const body = await request.json();
      const result = this.ctx.storage.sql.exec(body.sql, ...body.params || []).toArray();
      return Response.json({ result });
    }
    if (url.pathname === "/knowledge/sync" && request.method === "GET") {
      const items = this.ctx.storage.sql.exec(
        "SELECT id, processed_json FROM content_items WHERE processed_json IS NOT NULL AND synced_to_graph = 0 LIMIT 50"
      ).toArray();
      return Response.json({ items });
    }
    if (url.pathname === "/knowledge/mark-synced" && request.method === "POST") {
      const body = await request.json();
      if (Array.isArray(body.ids)) {
        for (const id of body.ids) {
          this.ctx.storage.sql.exec("UPDATE content_items SET synced_to_graph = 1 WHERE id = ?", id);
        }
      }
      return Response.json({ success: true });
    }
    if (url.pathname === "/ws") {
      const upgradeHeader = request.headers.get("Upgrade");
      if (!upgradeHeader || upgradeHeader !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("Not found", { status: 404 });
  }
  async handleIngest(request) {
    const body = await request.json();
    const id = crypto.randomUUID();
    const channels = this.ctx.storage.sql.exec("SELECT id FROM channels WHERE id = ?", body.chatId).toArray();
    if (channels.length === 0) {
      this.ctx.storage.sql.exec("INSERT INTO channels (id, name, created_at) VALUES (?, ?, ?)", body.chatId, body.title, Date.now());
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO content_items (id, source_id, source_name, raw_text, created_at) VALUES (?, ?, ?, ?, ?)",
      id,
      body.chatId,
      body.title,
      body.text,
      Date.now()
    );
    await this.ctx.storage.setAlarm(Date.now() + 5e3);
    return Response.json({ success: true, id });
  }
  async alarm() {
    await this.processBatch();
  }
  async processBatch() {
    const items = this.ctx.storage.sql.exec("SELECT * FROM content_items WHERE processed_json IS NULL AND retry_count < 5 LIMIT 10").toArray();
    if (items.length === 0) return;
    const bySource = {};
    for (const item of items) {
      if (!bySource[item.source_id]) bySource[item.source_id] = [];
      bySource[item.source_id].push(item);
    }
    for (const [sourceId, sourceItems] of Object.entries(bySource)) {
      await this.analyzeSourceBatch(sourceId, sourceItems);
    }
  }
  async analyzeSourceBatch(sourceId, items) {
    const texts = items.map((i) => `[ID: ${i.id}] ${i.raw_text}`).join("\n---\n");
    const systemPrompt = `You are an Institutional-Grade Financial Signal Extractor. Detect ANY market-relevant information. Output valid JSON array. Return [] only if NO financial data.`;
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent?key=${this.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: texts }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: { temperature: 0.2, response_mime_type: "application/json" }
          })
        }
      );
      const result = await response.json();
      const outputText = result.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
      const analysis = JSON.parse(outputText);
      const debugInfo = JSON.stringify({ batch_processed: true, analysis, raw_output: outputText, timestamp: Date.now() });
      for (const item of items) {
        this.ctx.storage.sql.exec("UPDATE content_items SET processed_json = ? WHERE id = ?", debugInfo, item.id);
      }
      for (const intel of analysis) {
        if (intel.relevance_score > 40) {
          await this.notifySignal(intel, sourceId, items[0].source_name);
          if (Array.isArray(intel.source_ids)) {
            for (const sid of intel.source_ids) {
              this.ctx.storage.sql.exec("UPDATE content_items SET is_signal = 1 WHERE id = ?", sid);
            }
          }
        }
      }
    } catch (e) {
      console.error("[ContentRefinery] Analysis failed:", e);
      const errorMsg = e instanceof Error ? e.message : String(e);
      for (const item of items) {
        this.ctx.storage.sql.exec(
          "UPDATE content_items SET retry_count = retry_count + 1, last_error = ? WHERE id = ?",
          errorMsg,
          item.id
        );
      }
    }
    const pending = this.ctx.storage.sql.exec("SELECT COUNT(*) as cnt FROM content_items WHERE processed_json IS NULL").toArray()[0];
    if (pending.cnt > 0) await this.ctx.storage.setAlarm(Date.now() + 2e3);
  }
  async notifySignal(intel, sourceId, sourceName) {
    if (!this.env.BOARD_DO_URL) {
      console.warn("[ContentRefinery] BOARD_DO_URL not configured. Signal not forwarded.");
      return;
    }
    const tickers = Array.isArray(intel.tickers) ? intel.tickers : [];
    const fingerprint = `${(intel.summary || "").toLowerCase().trim()}:${[...tickers].sort().join(",")}`;
    this.broadcastSignal(intel, sourceId, sourceName);
    this.ctx.blockConcurrencyWhile(async () => {
      await this.upsertToVectorize(intel);
    });
    try {
      let forwardedIntel = intel;
      if (intel.metadata?.privacy === "encrypted") {
        forwardedIntel = await this.encryptSignal(intel);
      }
      await this.fetchWithRetry(`${this.env.BOARD_DO_URL}/api/refinery/signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intel: forwardedIntel,
          sourceId,
          sourceName,
          fingerprint,
          timestamp: Date.now()
        })
      });
    } catch (e) {
      console.error("[ContentRefinery] Signal forwarding failed:", e);
    }
  }
  broadcastSignal(intel, sourceId, sourceName) {
    const payload = JSON.stringify({ type: "signal", data: { intel, sourceId, sourceName, timestamp: Date.now() } });
    this.ctx.getWebSockets().forEach((ws) => {
      try {
        ws.send(payload);
      } catch (e) {
      }
    });
  }
  async upsertToVectorize(intel) {
    if (!this.env.VECTOR_INDEX) return;
    try {
      const textToEmbed = `${intel.summary} ${intel.detail}`;
      const embedding = await this.getEmbeddings(textToEmbed);
      await this.env.VECTOR_INDEX.upsert([{
        id: crypto.randomUUID(),
        values: embedding,
        metadata: {
          summary: intel.summary,
          tickers: JSON.stringify(intel.tickers || []),
          sentiment: intel.sentiment || "neutral"
        }
      }]);
      console.log("[ContentRefinery] Successfully upserted to Vectorize");
    } catch (e) {
      console.error("[ContentRefinery] Vectorize upsert failed:", e);
    }
  }
  async getEmbeddings(text) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${this.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { parts: [{ text }] }
        })
      }
    );
    const result = await response.json();
    return result.embedding.values;
  }
  async encryptSignal(intel) {
    const secret = this.env.GEMINI_API_KEY;
    const encoded = new TextEncoder().encode(JSON.stringify(intel));
    return btoa(String.fromCharCode(...new Uint8Array(encoded)));
  }
  // WebSocket Handlers
  async webSocketMessage(ws, message) {
  }
  async webSocketClose(ws, code, reason, wasClean) {
    ws.close(code, reason);
  }
};

// src/worker.ts
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return new Response("Content Refinery Active", { status: 200 });
    }
    const id = env.CONTENT_DO.idFromName("default");
    const stub = env.CONTENT_DO.get(id);
    if (request.headers.get("Upgrade") === "websocket") {
      return stub.fetch(request);
    }
    return stub.fetch(request);
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-ShFyCG/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-ShFyCG/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  ContentDO,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
