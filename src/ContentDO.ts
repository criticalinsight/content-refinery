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
                created_at INTEGER
            );
        `);

        // Migration: Add new columns if they don't exist
        try { this.ctx.storage.sql.exec(`ALTER TABLE channels ADD COLUMN success_count INTEGER DEFAULT 0`); } catch (e) { }
        try { this.ctx.storage.sql.exec(`ALTER TABLE channels ADD COLUMN failure_count INTEGER DEFAULT 0`); } catch (e) { }
        try { this.ctx.storage.sql.exec(`ALTER TABLE channels ADD COLUMN last_ingested_at INTEGER`); } catch (e) { }
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

        await this.ctx.storage.setAlarm(Date.now() + 5000);
        return Response.json({ success: true, id });
    }

    async alarm() {
        await this.processBatch();
    }

    private async processBatch() {
        const items = this.ctx.storage.sql.exec('SELECT * FROM content_items WHERE processed_json IS NULL LIMIT 10').toArray() as any[];
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
        const sixHoursAgo = Date.now() - (6 * 60 * 60 * 1000);

        try {
            // Forward signal to main app via REST
            await this.fetchWithRetry(`${this.env.BOARD_DO_URL}/api/refinery/signal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    intel,
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
}
