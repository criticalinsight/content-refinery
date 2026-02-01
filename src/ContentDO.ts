import { DurableObject } from 'cloudflare:workers';
import { Env, Signal } from './types';
import { ErrorLogger } from './ErrorLogger';
import { FactStore } from './FactStore';
import { Router } from './api/Router';
import { TelegramCollector } from './collectors/TelegramCollector';
import { Orchestrator } from './logic/Orchestrator';
import { RSSCollector } from './collectors/RSSCollector';
import { WebhookCollector } from './collectors/WebhookCollector';

/**
 * ContentRefinery Durable Object (V2.0 - Hickey Decomplection)
 * Acts as a lean coordinator/event-bridge between infrastructure and logic.
 */
export class ContentDO extends DurableObject<Env> {
    private logger: ErrorLogger;
    private store: FactStore;
    private router: Router;
    private telegram: TelegramCollector;
    private rss: RSSCollector;
    private webhooks: WebhookCollector;
    private orchestrator: Orchestrator;

    private signalCache: { data: any, timestamp: number } | null = null;
    private narrativeCache: { data: any, timestamp: number } | null = null;
    private CACHE_TTL = 30 * 1000;

    private rateLimiter = new Map<string, number[]>();
    private sessions = new Set<WebSocket>();

    constructor(ctx: DurableObjectState, public env: Env) {
        super(ctx, env);
        this.store = new FactStore(this.ctx.storage);
        this.logger = new ErrorLogger(this.ctx.storage);
        this.telegram = new TelegramCollector(this.env, this.ctx.storage, this.store, this.logger);
        this.rss = new RSSCollector(this.ctx.storage);
        this.webhooks = new WebhookCollector();
        this.orchestrator = new Orchestrator(
            this.store, this.logger, this.telegram, this.rss, this.webhooks, this.env, this.ctx.storage
        );
        this.router = new Router(this.store, this.env, this.ctx.storage, this.orchestrator);

        this.ctx.blockConcurrencyWhile(async () => {
            this.migrateSchema();
            const alarm = await this.ctx.storage.getAlarm();
            if (alarm === null) {
                console.log('[ContentDO] No alarm found, priming heartbeat (5 mins)...');
                await this.ctx.storage.setAlarm(Date.now() + 5 * 60 * 1000);
            }
        });
    }

    async fetch(request: Request): Promise<Response> {
        if (request.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
        if (this.isRateLimited(request)) return this.addCors(new Response('Too many requests', { status: 429 }));

        const url = new URL(request.url);

        const routerResponse = await this.router.handle(request, {
            getCache: (t) => this.getCache(t),
            setCache: (t, d) => this.setCache(t, d),
            generateEmbeddings: (t) => this.generateEmbeddings(t)
        });

        if (routerResponse.status !== 404) return this.addCors(routerResponse);
        if (url.pathname === '/ws') return this.handleWebSocket(request);
        if (url.pathname === '/telegram-webhook' && request.method === 'POST') {
            return await this.handleTelegramUpdate(request);
        }

        return this.addCors(new Response('Not Found', { status: 404 }));
    }

    async alarm() {
        console.log('[ContentDO] Alarm pulse triggered.');
        const { active } = await this.orchestrator.tick();

        const lastInterval = await this.ctx.storage.get<number>('current_heartbeat_interval') || 5 * 60 * 1000;
        let nextInterval = 5 * 60 * 1000;

        if (active) {
            console.log('[ContentDO] Activity detected. Resetting heartbeat to 5 mins.');
            nextInterval = 5 * 60 * 1000;
        } else {
            nextInterval = Math.min(lastInterval * 2, 60 * 60 * 1000);
            console.log(`[ContentDO] No activity. Backing off to ${nextInterval / 1000 / 60} mins.`);
        }

        await this.ctx.storage.put('current_heartbeat_interval', nextInterval);
        const nextAlarm = Date.now() + nextInterval;
        await this.ctx.storage.setAlarm(nextAlarm);
        console.log(`[ContentDO] Next alarm scheduled: ${new Date(nextAlarm).toISOString()}`);
    }

    private async handleTelegramUpdate(request: Request): Promise<Response> {
        try {
            const update = await request.json();
            await this.telegram.handleUpdate(update, async (msg) => {
                await this.handleIngestInternal(msg);
            });
            return new Response('OK', { status: 200 });
        } catch (e: any) {
            console.error('[ContentDO] Failed to handle Telegram update:', e);
            return new Response('Error', { status: 500 });
        }
    }

    private async handleIngestInternal(body: IngestRequest): Promise<string | null> {
        const result = await this.orchestrator.processIngest(body, {
            scrub: (t) => this.scrubSensitiveContent(t),
            analyzeImage: async (b) => {
                const fileId = body.media?.file_id;
                if (!fileId) return "[IMAGE]";
                const buffer = await this.telegram.downloadMedia(fileId);
                return buffer ? await this.analyzeImage(buffer) : "[IMAGE DOWNLOAD FAILED]";
            },
            transcribeAudio: async (b) => {
                const fileId = body.media?.file_id;
                if (!fileId) return "[AUDIO]";
                const buffer = await this.telegram.downloadMedia(fileId);
                return buffer ? await this.transcribeAudio(buffer) : "[AUDIO DOWNLOAD FAILED]";
            }
        });

        if (result && result !== "no_content" && result !== "callback_processed") {
            await this.resetHeartbeat();
        }

        return result;
    }

    private async resetHeartbeat() {
        const interval = await this.ctx.storage.get<number>('current_heartbeat_interval') || 5 * 60 * 1000;
        if (interval > 5 * 60 * 1000) {
            console.log('[ContentDO] ⚡ New content ingested. Shortening heartbeat to 5 mins.');
            await this.ctx.storage.put('current_heartbeat_interval', 5 * 60 * 1000);
            await this.ctx.storage.setAlarm(Date.now() + 5 * 60 * 1000);
        }
    }

    // --- INFRASTRUCTURE HELPERS ---

    private async scrubSensitiveContent(text: string): Promise<string | null> {
        if (!text) return text;
        const patterns = [
            { regex: /[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{4}/g, replacement: '[CREDIT_CARD]' },
            { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL]' }
        ];
        let scrubbed = text;
        for (const p of patterns) scrubbed = scrubbed.replace(p.regex, p.replacement);
        return scrubbed;
    }

    private async analyzeImage(buffer: Uint8Array): Promise<string> {
        // ... Omni-Alpha logic call
        return "[IMAGE ANALYSIS]";
    }

    private async transcribeAudio(buffer: Uint8Array): Promise<string> {
        // ... Voice-Alpha logic call
        return "[AUDIO TRANSCRIPTION]";
    }

    private async generateEmbeddings(text: string): Promise<number[] | null> {
        try {
            const response = await this.env.AI.run('@cf/baai/bge-base-en-v1.5', { text });
            return response.data[0];
        } catch (e) {
            console.error('Embedding error:', e);
            return null;
        }
    }

    private addCors(res: Response): Response {
        const headers = new Headers(res.headers);
        headers.set('Access-Control-Allow-Origin', '*');
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }

    private isRateLimited(req: Request): boolean {
        const ip = req.headers.get('cf-connecting-ip') || 'anon';
        const now = Date.now();
        const timestamps = this.rateLimiter.get(ip) || [];
        const valid = timestamps.filter(t => now - t < 60000);
        if (valid.length > 50) return true;
        valid.push(now);
        this.rateLimiter.set(ip, valid);
        return false;
    }

    private getCache(type: 'signal' | 'narrative') {
        const cache = type === 'signal' ? this.signalCache : this.narrativeCache;
        if (cache && Date.now() - cache.timestamp < this.CACHE_TTL) return cache.data;
        return null;
    }

    private setCache(type: 'signal' | 'narrative', data: any) {
        const entry = { data, timestamp: Date.now() };
        if (type === 'signal') this.signalCache = entry;
        else this.narrativeCache = entry;
    }

    private handleWebSocket(request: Request): Response {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        (server as any).accept();
        this.sessions.add(server as unknown as WebSocket);
        server.addEventListener('close', () => this.sessions.delete(server as unknown as WebSocket));
        server.addEventListener('error', () => this.sessions.delete(server as unknown as WebSocket));
        return new Response(null, { status: 101, webSocket: client });
    }

    private broadcast(data: any) {
        const msg = JSON.stringify(data);
        for (const session of this.sessions) {
            try {
                session.send(msg);
            } catch (e) {
                this.sessions.delete(session);
            }
        }
    }

    private migrateSchema() {
        this.ctx.storage.sql.exec(`
            CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, name TEXT, created_at INTEGER);
            CREATE TABLE IF NOT EXISTS content_items (
                id TEXT PRIMARY KEY, 
                source_id TEXT, 
                source_name TEXT, 
                raw_text TEXT, 
                content_hash TEXT, 
                created_at INTEGER, 
                is_signal INTEGER DEFAULT 0, 
                processed_json JSON, 
                sentiment TEXT, 
                tags TEXT, 
                last_analyzed_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_content_hash ON content_items(content_hash);
            CREATE INDEX IF NOT EXISTS idx_created_at ON content_items(created_at);
            
            CREATE TABLE IF NOT EXISTS graph_nodes (id TEXT PRIMARY KEY, label TEXT, importance REAL, type TEXT, centrality REAL DEFAULT 0, sentiment_score REAL DEFAULT 0, velocity REAL DEFAULT 0, conviction_score REAL DEFAULT 0, last_updated INTEGER);
            CREATE TABLE IF NOT EXISTS graph_edges (source TEXT, target TEXT, relation TEXT, weight REAL, PRIMARY KEY (source, target, relation));
            CREATE TABLE IF NOT EXISTS narratives (id TEXT PRIMARY KEY, title TEXT, summary TEXT, signals JSON, created_at INTEGER);
            CREATE TABLE IF NOT EXISTS internal_errors (id TEXT PRIMARY KEY, module TEXT, message TEXT, context TEXT, created_at INTEGER);
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value JSON);
            CREATE TABLE IF NOT EXISTS sentiment_snapshots (id TEXT PRIMARY KEY, entity_id TEXT, timestamp INTEGER, sentiment REAL, signal_id TEXT, relevance_score REAL);
            CREATE TABLE IF NOT EXISTS predictions (id TEXT PRIMARY KEY, entity_id TEXT, prediction_type TEXT, conviction_score REAL, predicted_at INTEGER, outcome TEXT, verified_at INTEGER);
            CREATE INDEX IF NOT EXISTS idx_sentiment_entity ON sentiment_snapshots(entity_id, timestamp);
            CREATE INDEX IF NOT EXISTS idx_predictions_entity ON predictions(entity_id, predicted_at);
        `);
    }
}
