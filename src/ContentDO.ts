import { DurableObject } from 'cloudflare:workers';
import { Env } from './types';
import { ErrorLogger } from './ErrorLogger';
import { FactStore } from './FactStore';
import { TelegramCollector } from './collectors/TelegramCollector';
import { AlphaPipe } from './logic/AlphaPipe';

/**
 * ContentRefinery Durable Object (V3.0 - Alpha Pipe)
 * Stripped of accidental complexity, focusing on the core ingestion flow.
 */
export class ContentDO extends DurableObject<Env> {
    private logger: ErrorLogger;
    private store: FactStore;
    private telegram: TelegramCollector;
    private pipe: AlphaPipe;

    constructor(ctx: DurableObjectState, public env: Env) {
        super(ctx, env);
        this.store = new FactStore(this.ctx.storage);
        this.logger = new ErrorLogger(this.ctx.storage);
        this.telegram = new TelegramCollector(this.env, this.ctx.storage, this.store, this.logger);
        this.pipe = new AlphaPipe(this.store, this.telegram, this.env, this.ctx.storage);

        this.ctx.blockConcurrencyWhile(async () => {
            this.migrateSchema();
        });
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        if (url.pathname === '/telegram-webhook' && request.method === 'POST') {
            try {
                const update = await request.json();
                await this.telegram.handleUpdate(update, async (msg) => {
                    await this.pipe.processIngest(msg);
                });
                return new Response('OK');
            } catch (e) {
                return new Response('Error', { status: 500 });
            }
        }

        if (url.pathname === '/stats') {
            return Response.json({ status: 'online', metrics: this.store.getStats() });
        }

        return new Response('Not Found', { status: 404 });
    }

    private migrateSchema() {
        this.ctx.storage.sql.exec(`
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
            
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value JSON);
            CREATE TABLE IF NOT EXISTS internal_errors (id TEXT PRIMARY KEY, module TEXT, message TEXT, context TEXT, created_at INTEGER);
            CREATE INDEX IF NOT EXISTS idx_internal_errors_created_at ON internal_errors(created_at);
        `);
    }
}
