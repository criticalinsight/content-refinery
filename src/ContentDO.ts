import { DurableObject } from 'cloudflare:workers';
import { Env } from './types';

interface ChannelConfig {
    id: string; // Telegram Chat ID
    name: string;
    targetBoardId?: string;
    targetListMap?: Record<string, string>; // e.g. { "bullish": "list-1", "action": "list-2" }
}

export class ContentDO extends DurableObject<Env> {

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.ctx.getWebSockets().forEach(ws => {
            // Re-bind handlers after restart if needed
        });
        this.initDatabase();
    }

    private initDatabase() {
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

        // Migration: Add new columns if they don't exist
        try { this.ctx.storage.sql.exec(`ALTER TABLE channels ADD COLUMN success_count INTEGER DEFAULT 0`); } catch (e) { }
        try { this.ctx.storage.sql.exec(`ALTER TABLE channels ADD COLUMN failure_count INTEGER DEFAULT 0`); } catch (e) { }
        try { this.ctx.storage.sql.exec(`ALTER TABLE channels ADD COLUMN last_ingested_at INTEGER`); } catch (e) { }
        try { this.ctx.storage.sql.exec(`ALTER TABLE content_items ADD COLUMN retry_count INTEGER DEFAULT 0`); } catch (e) { }
        try { this.ctx.storage.sql.exec(`ALTER TABLE content_items ADD COLUMN last_error TEXT`); } catch (e) { }
        try { this.ctx.storage.sql.exec(`ALTER TABLE content_items ADD COLUMN synced_to_graph INTEGER DEFAULT 0`); } catch (e) { }
    }

    // Generic retry helper for external fetch
    private async fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
        let lastError: Error | null = null;
        for (let i = 0; i < maxRetries; i++) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 30000);
                const res = await fetch(url, { ...options, signal: controller.signal });
                clearTimeout(timeout);
                if (res.ok) return res;
                if (res.status === 429 || res.status >= 500) throw new Error(`Server error: ${res.status}`);
                return res;
            } catch (e) {
                lastError = e as Error;
                const delay = 1000 * Math.pow(2, i);
                console.warn(`[ContentRefinery] Retry ${i + 1}/${maxRetries} to ${url} after ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
        throw lastError || new Error('Fetch failed');
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        if (url.pathname === '/health') {
            return Response.json({ status: 'healthy', timestamp: new Date().toISOString() });
        }

        if (url.pathname === '/stats' && request.method === 'GET') {
            const totalItems = this.ctx.storage.sql.exec('SELECT COUNT(*) as cnt FROM content_items').toArray()[0] as any;
            const signalCount = this.ctx.storage.sql.exec('SELECT COUNT(*) as cnt FROM content_items WHERE is_signal = 1').toArray()[0] as any;
            const processedCount = this.ctx.storage.sql.exec('SELECT COUNT(*) as cnt FROM content_items WHERE processed_json IS NOT NULL').toArray()[0] as any;
            return Response.json({
                totalItems: totalItems?.cnt || 0,
                processedItems: processedCount?.cnt || 0,
                signals: signalCount?.cnt || 0,
                timestamp: new Date().toISOString()
            });
        }

        if (url.pathname === '/ingest' && request.method === 'POST') {
            return this.handleIngest(request);
        }

        if (url.pathname === '/process' && request.method === 'POST') {
            await this.processBatch();
            return Response.json({ success: true });
        }

        if (url.pathname === '/sql' && request.method === 'POST') {
            const body = await request.json() as any;
            const result = this.ctx.storage.sql.exec(body.sql, ...(body.params || [])).toArray();
            return Response.json({ result });
        }

        if (url.pathname === '/knowledge/sync' && request.method === 'GET') {
            const items = this.ctx.storage.sql.exec(
                'SELECT id, processed_json FROM content_items WHERE processed_json IS NOT NULL AND synced_to_graph = 0 LIMIT 50'
            ).toArray();
            return Response.json({ items });
        }

        if (url.pathname === '/knowledge/mark-synced' && request.method === 'POST') {
            const body = await request.json() as any;
            if (Array.isArray(body.ids)) {
                for (const id of body.ids) {
                    this.ctx.storage.sql.exec('UPDATE content_items SET synced_to_graph = 1 WHERE id = ?', id);
                }
            }
            return Response.json({ success: true });
        }

        if (url.pathname === '/ws') {
            const upgradeHeader = request.headers.get('Upgrade');
            if (!upgradeHeader || upgradeHeader !== 'websocket') {
                return new Response('Expected Upgrade: websocket', { status: 426 });
            }

            const pair = new WebSocketPair();
            const [client, server] = Object.values(pair);

            this.ctx.acceptWebSocket(server);

            return new Response(null, { status: 101, webSocket: client });
        }

        return new Response('Not found', { status: 404 });
    }

    async handleIngest(request: Request): Promise<Response> {
        const body = await request.json() as any;
        const id = crypto.randomUUID();

        // Auto-register channel
        const channels = this.ctx.storage.sql.exec('SELECT id FROM channels WHERE id = ?', body.chatId).toArray();
        if (channels.length === 0) {
            this.ctx.storage.sql.exec('INSERT INTO channels (id, name, created_at) VALUES (?, ?, ?)', body.chatId, body.title, Date.now());
        }

        this.ctx.storage.sql.exec(
            'INSERT INTO content_items (id, source_id, source_name, raw_text, created_at) VALUES (?, ?, ?, ?, ?)',
            id, body.chatId, body.title, body.text, Date.now()
        );

        // Note: For Phase 2, we will add a metadata column to SQLite and update this.

        await this.ctx.storage.setAlarm(Date.now() + 5000);
        return Response.json({ success: true, id });
    }

    async alarm() {
        await this.processBatch();
    }

    private async processBatch() {
        const items = this.ctx.storage.sql.exec('SELECT * FROM content_items WHERE processed_json IS NULL AND retry_count < 5 LIMIT 10').toArray() as any[];
        if (items.length === 0) return;

        const bySource: Record<string, any[]> = {};
        for (const item of items) {
            if (!bySource[item.source_id]) bySource[item.source_id] = [];
            bySource[item.source_id].push(item);
        }

        for (const [sourceId, sourceItems] of Object.entries(bySource)) {
            await this.analyzeSourceBatch(sourceId, sourceItems);
        }
    }

    private async analyzeSourceBatch(sourceId: string, items: any[]) {
        const texts = items.map(i => `[ID: ${i.id}] ${i.raw_text}`).join('\n---\n');
        const systemPrompt = `You are an Institutional-Grade Financial Signal Extractor. Detect ANY market-relevant information. Output valid JSON array. Return [] only if NO financial data.`;

        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent?key=${this.env.GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ role: 'user', parts: [{ text: texts }] }],
                        systemInstruction: { parts: [{ text: systemPrompt }] },
                        generationConfig: { temperature: 0.2, response_mime_type: "application/json" }
                    })
                }
            );

            const result = await response.json() as any;
            const outputText = result.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
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
                            this.ctx.storage.sql.exec('UPDATE content_items SET is_signal = 1 WHERE id = ?', sid);
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[ContentRefinery] Analysis failed:', e);
            const errorMsg = e instanceof Error ? e.message : String(e);
            for (const item of items) {
                this.ctx.storage.sql.exec(
                    "UPDATE content_items SET retry_count = retry_count + 1, last_error = ? WHERE id = ?",
                    errorMsg, item.id
                );
            }
        }

        const pending = this.ctx.storage.sql.exec('SELECT COUNT(*) as cnt FROM content_items WHERE processed_json IS NULL').toArray()[0] as any;
        if (pending.cnt > 0) await this.ctx.storage.setAlarm(Date.now() + 2000);
    }

    private async notifySignal(intel: any, sourceId: string, sourceName: string) {
        if (!this.env.BOARD_DO_URL) {
            console.warn('[ContentRefinery] BOARD_DO_URL not configured. Signal not forwarded.');
            return;
        }

        const tickers = Array.isArray(intel.tickers) ? intel.tickers : [];
        const fingerprint = `${(intel.summary || "").toLowerCase().trim()}:${[...tickers].sort().join(',')}`;

        // 1. Broadcast to WebSocket clients
        this.broadcastSignal(intel, sourceId, sourceName);

        // 2. Generate Embeddings & Update Vectorize
        this.ctx.blockConcurrencyWhile(async () => {
            await this.upsertToVectorize(intel);
        });

        try {
            // 3. Encrypt if necessary (Private Feed logic)
            let forwardedIntel = intel;
            if (intel.metadata?.privacy === 'encrypted') {
                forwardedIntel = await this.encryptSignal(intel);
            }

            // Forward signal to main app via REST
            await this.fetchWithRetry(`${this.env.BOARD_DO_URL}/api/refinery/signal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    intel: forwardedIntel,
                    sourceId,
                    sourceName,
                    fingerprint,
                    timestamp: Date.now()
                })
            });
        } catch (e) {
            console.error('[ContentRefinery] Signal forwarding failed:', e);
        }
    }

    private broadcastSignal(intel: any, sourceId: string, sourceName: string) {
        const payload = JSON.stringify({ type: 'signal', data: { intel, sourceId, sourceName, timestamp: Date.now() } });
        this.ctx.getWebSockets().forEach(ws => {
            try { ws.send(payload); } catch (e) { }
        });
    }

    private async upsertToVectorize(intel: any) {
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
                    sentiment: intel.sentiment || 'neutral'
                }
            }]);
            console.log('[ContentRefinery] Successfully upserted to Vectorize');
        } catch (e) {
            console.error('[ContentRefinery] Vectorize upsert failed:', e);
        }
    }

    private async getEmbeddings(text: string): Promise<number[]> {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${this.env.GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: { parts: [{ text }] }
                })
            }
        );
        const result = await response.json() as any;
        return result.embedding.values;
    }

    private async encryptSignal(intel: any): Promise<string> {
        // Simple mock encryption (AES-256-GCM logic would go here)
        // For brevity in CF Worker, we'll use a placeholder or base64
        const secret = this.env.GEMINI_API_KEY; // Using API key as derivation source for demo
        const encoded = new TextEncoder().encode(JSON.stringify(intel));
        return btoa(String.fromCharCode(...new Uint8Array(encoded)));
    }

    // WebSocket Handlers
    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
        // Optional: Handle client commands (e.g. subscribe to specific tickers)
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
        ws.close(code, reason);
    }
}
