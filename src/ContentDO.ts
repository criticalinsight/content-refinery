import { DurableObject } from 'cloudflare:workers';
import { Env } from './types';
import { TelegramManager } from './telegram';
import { fetchAndParseRSS } from './utils/rss';
import { ErrorLogger } from './ErrorLogger';

interface ChannelConfig {
    id: string; // Telegram Chat ID
    name: string;
    targetBoardId?: string;
    targetListMap?: Record<string, string>; // e.g. { "bullish": "list-1", "action": "list-2" }
}

/**
 * ContentDO is a Durable Object responsible for signal ingestion, 
 * market narrative synthesis, and knowledge graph maintenance.
 * 
 * Time Complexity (Ingestion): O(1) per message (SHA-256 is constant time relative to fixed-size chunks)
 * Space Complexity (Storage): O(N) where N is the number of stored content items and graph nodes.
 */
export class ContentDO extends DurableObject<Env> {

    private telegram: TelegramManager | null = null;
    private logger: ErrorLogger;

    // In-memory caches (v1.7)
    private signalCache: { data: any, timestamp: number } | null = null;
    private narrativeCache: { data: any, timestamp: number } | null = null;
    private CACHE_TTL = 30 * 1000; // 30 seconds

    // Rate limiting: IP -> timestamp[]
    private rateLimiter = new Map<string, number[]>();
    private RATE_LIMIT_THRESHOLD = 60; // requests
    private RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

    constructor(ctx: DurableObjectState, public env: Env) {
        super(ctx, env);
        this.logger = new ErrorLogger(this.ctx.storage);
        this.migrateSchema();
        this.resumeTelegramSession();

        // Schedule first janitor run if not already set
        this.scheduleNextMaintenance();
    }

    /**
     * Schedules the next maintenance window (Janitor/Reflexion).
     */
    private async scheduleNextMaintenance() {
        const alarm = await this.ctx.storage.getAlarm();
        if (alarm === null) {
            // Run every 12 hours
            this.ctx.storage.setAlarm(Date.now() + 12 * 60 * 60 * 1000);
        }
    }

    private async resumeTelegramSession() {
        try {
            const sessionStr = await this.ctx.storage.get<string>('tg_session');
            if (sessionStr) {
                await this.ensureTelegram();
                console.log("[ContentRefinery] Telegram session auto-resumed on startup.");
            }
        } catch (e) {
            console.error("[ContentRefinery] Failed to auto-resume Telegram:", e);
        }
    }

    private async ensureTelegram(): Promise<TelegramManager> {
        if (this.telegram && this.telegram.getClient()?.connected) return this.telegram;

        const sessionStr = await this.ctx.storage.get<string>('tg_session') || "";
        this.telegram = new TelegramManager(this.env, sessionStr, async (newSession) => {
            await this.ctx.storage.put('tg_session', newSession);
            console.log("[ContentRefinery] Telegram session updated and persisted.");
        });
        await this.telegram.connect();

        // Auto-start listener if logged in
        if (await this.telegram.isLoggedIn()) {
            this.telegram.listen(async (msg) => {
                await this.handleIngestInternal(msg);
            });
            console.log("[ContentRefinery] Live Telegram listener resumed.");
        }

        return this.telegram;
    }

    /**
     * migrates the SQLite schema to the latest version.
     * Time Complexity: O(1) (Fixed number of schema operations)
     */
    private migrateSchema() {
        this.ctx.storage.sql.exec(`
            CREATE TABLE IF NOT EXISTS channels (
                id TEXT PRIMARY KEY,
                name TEXT,
                config JSON,
                created_at INTEGER,
                success_count INTEGER DEFAULT 0,
                failure_count INTEGER DEFAULT 0,
                last_ingested_at INTEGER,
                type TEXT DEFAULT 'telegram',
                feed_url TEXT
            );

            CREATE TABLE IF NOT EXISTS internal_errors (
                id TEXT PRIMARY KEY,
                module TEXT,
                message TEXT,
                stack TEXT,
                context JSON,
                created_at INTEGER
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
                content_hash TEXT,
                tags JSON,
                created_at INTEGER
            );

            CREATE INDEX IF NOT EXISTS idx_content_hash ON content_items(content_hash);

            CREATE TABLE IF NOT EXISTS graph_nodes (
                id TEXT PRIMARY KEY,
                label TEXT,
                type TEXT,
                importance REAL DEFAULT 1.0,
                sentiment_score REAL DEFAULT 0,
                velocity REAL DEFAULT 0,
                last_seen INTEGER
            );

            CREATE TABLE IF NOT EXISTS graph_edges (
                source TEXT,
                target TEXT,
                relation TEXT,
                weight REAL DEFAULT 1.0,
                last_seen INTEGER,
                PRIMARY KEY (source, target, relation)
            );

            CREATE TABLE IF NOT EXISTS narratives (
                id TEXT PRIMARY KEY,
                title TEXT,
                summary TEXT,
                sentiment TEXT,
                signals TEXT, -- JSON array of signal IDs
                created_at INTEGER
            );
        `);

        // Apply missing migrations (Backwards compatibility for v1.0-v1.6)
        const columns = [
            { table: 'channels', col: 'success_count', type: 'INTEGER DEFAULT 0' },
            { table: 'channels', col: 'failure_count', type: 'INTEGER DEFAULT 0' },
            { table: 'content_items', col: 'content_hash', type: 'TEXT' },
            { table: 'content_items', col: 'tags', type: 'JSON' },
            { table: 'graph_nodes', col: 'sentiment_score', type: 'REAL DEFAULT 0' },
            { table: 'graph_nodes', col: 'velocity', type: 'REAL DEFAULT 0' }
        ];

        for (const { table, col, type } of columns) {
            try { this.ctx.storage.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch (e) { }
        }

        // Phase 22: Push Subscriptions
        this.ctx.storage.sql.exec(`
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id TEXT PRIMARY KEY,
                endpoint TEXT,
                p256dh TEXT,
                auth TEXT,
                created_at INTEGER
            );
        `);
    }

    /**
     * Generic retry helper for external fetch operations.
     * Time Complexity: O(R * T) where R is maxRetries and T is request time.
     * Space Complexity: O(1)
     */
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
        if (this.isRateLimited(request)) {
            return new Response('Too many requests', { status: 429 });
        }
        const url = new URL(request.url);

        if (url.pathname === '/health' || url.pathname === '/stats') {
            return this.handleHealthStats(request, url);
        }

        if (url.pathname.startsWith('/analytics')) {
            return this.handleAnalytics(request, url);
        }

        if (url.pathname.startsWith('/notifications')) {
            return this.handleNotifications(request, url);
        }

        if (url.pathname.startsWith('/telegram')) {
            return this.handleTelegramRoutes(request, url);
        }

        if (url.pathname === '/ingest' || url.pathname === '/process' || url.pathname === '/sql') {
            return this.handleAdmin(request, url);
        }

        if (url.pathname === '/ws') {
            return this.handleWebSocket(request);
        }

        if (url.pathname === '/sources/rss') {
            return this.handleRSS(request, url);
        }

        if (url.pathname.startsWith('/webhooks/')) {
            const type = url.pathname.split('/')[2] as any;
            return this.handleWebhook(request, type);
        }

        if (url.pathname.startsWith('/knowledge')) {
            return this.handleKnowledgeSync(request, url);
        }

        if (url.pathname.startsWith('/telegram/auth')) {
            return this.handleTelegramAuth(request, url);
        }

        if (url.pathname.startsWith('/signals')) {
            return this.handleSignalSearch(request, url);
        }

        if (url.pathname === '/internal/scheduled') {
            const { cron } = await request.json() as any;
            await this.handleScheduled(cron);
            return Response.json({ success: true });
        }

        return new Response('Not found', { status: 404 });
    }

    /**
     * Handles Telegram authentication and status endpoints.
     */
    private async handleTelegramAuth(request: Request, url: URL): Promise<Response> {
        if (url.pathname === '/telegram/auth/status' && request.method === 'GET') {
            if (!this.env.TELEGRAM_API_ID || !this.env.TELEGRAM_API_HASH) {
                return this.sendError('TELEGRAM_API_ID and TELEGRAM_API_HASH must be set as secrets.', 500, { status: 'unconfigured' });
            }
            try {
                const tg = await this.ensureTelegram();
                const loggedIn = await tg.isLoggedIn();
                return Response.json({ status: loggedIn ? 'online' : 'offline' });
            } catch (e) {
                return this.sendError(e instanceof Error ? e.message : String(e), 400, { status: 'error' });
            }
        }

        if (url.pathname === '/telegram/auth/send-code' && request.method === 'POST') {
            const { phone } = await request.json() as any;
            const tg = await this.ensureTelegram();
            try {
                const phoneCodeHash = await tg.sendCode(phone);
                await this.ctx.storage.put('tg_phone', phone);
                await this.ctx.storage.put('tg_phone_code_hash', phoneCodeHash);
                return Response.json({ success: true, message: 'Code sent to your Telegram app' });
            } catch (e) {
                return this.sendError(e instanceof Error ? e.message : String(e));
            }
        }

        if (url.pathname === '/telegram/auth/sign-in' && request.method === 'POST') {
            const { code, password } = await request.json() as any;
            const phone = await this.ctx.storage.get<string>('tg_phone');
            const phoneCodeHash = await this.ctx.storage.get<string>('tg_phone_code_hash');

            if (!phone || !phoneCodeHash) return this.sendError('No pending sign-in. Call send-code first.');

            const tg = await this.ensureTelegram();
            try {
                let newSession = password ? await tg.checkPassword(password) : await tg.signIn(phone, phoneCodeHash, code);
                await this.ctx.storage.put('tg_session', newSession);
                tg.listen(async (msg) => { await this.handleIngestInternal(msg); });
                return Response.json({ success: true });
            } catch (e: any) {
                if (e.message === '2FA_REQUIRED') return Response.json({ success: false, requires2FA: true, error: '2FA required' });
                return this.sendError(e.message);
            }
        }

        if (url.pathname === '/telegram/auth/me' && request.method === 'GET') {
            try {
                const tg = await this.ensureTelegram();
                const client = tg.getClient();
                if (!client || !await tg.isLoggedIn()) return Response.json({ loggedIn: false });
                const me = await client.getMe();
                return Response.json({
                    loggedIn: true,
                    user: { id: me.id?.toString(), firstName: me.firstName, lastName: me.lastName, username: me.username }
                });
            } catch (e) {
                return Response.json({ loggedIn: false, error: String(e) });
            }
        }

        if (url.pathname === '/telegram/auth/qr-token') {
            const tg = await this.ensureTelegram();
            try {
                const tokenData = await tg.getQrLoginToken();
                return Response.json({ success: true, ...tokenData });
            } catch (e) {
                return this.sendError(String(e));
            }
        }

        if (url.pathname === '/telegram/auth/qr-check') {
            const tg = await this.ensureTelegram();
            try {
                const result = await tg.checkQrLogin();
                if (result.success && result.session) {
                    await this.ctx.storage.put('tg_session', result.session);
                    tg.listen(async (msg) => { await this.handleIngestInternal(msg); });
                    return Response.json({ success: true, loggedIn: true });
                }
                return Response.json({ success: true, loggedIn: false, needsPassword: result.needsPassword });
            } catch (e) {
                return this.sendError(String(e));
            }
        }

        if (url.pathname === '/telegram/auth/qr-password') {
            const { password } = await request.json() as any;
            if (!password) return this.sendError('Password required');
            const tg = await this.ensureTelegram();
            try {
                const newSession = await tg.checkPassword(password);
                await this.ctx.storage.put('tg_session', newSession);
                tg.listen(async (msg) => { await this.handleIngestInternal(msg); });
                return Response.json({ success: true });
            } catch (e) {
                return this.sendError(String(e));
            }
        }

        return this.sendError('Not found', 404);
    }

    /**
     * Handles signal search, listing, and export endpoints.
     * Time Complexity (Search): O(N) where N is the number of signals (SQL indexed on created_at).
     * Time Complexity (Export): O(N) where N is the number of items to format.
     */
    private async handleSignalSearch(request: Request, url: URL): Promise<Response> {
        // Signal Search with filters
        if (url.pathname === '/signals/search' && request.method === 'GET') {
            const query = url.searchParams.get('q') || '';
            const source = url.searchParams.get('source');
            const sentiment = url.searchParams.get('sentiment');
            const urgent = url.searchParams.get('urgent');
            const from = url.searchParams.get('from');
            const to = url.searchParams.get('to');
            const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

            const offset = parseInt(url.searchParams.get('offset') || '0');

            // Basic caching for unfiltered requests
            if (!query && !source && !sentiment && !urgent && !from && !to && offset === 0) {
                const cached = this.getCache('signal');
                if (cached) return Response.json(cached);
            }

            let sql = `SELECT id, source_id, source_name, raw_text, processed_json, sentiment, created_at 
                       FROM content_items WHERE is_signal = 1`;
            const params: any[] = [];

            if (query) {
                sql += ` AND raw_text LIKE ?`;
                params.push(`%${query}%`);
            }
            if (source) {
                sql += ` AND source_name = ?`;
                params.push(source);
            }
            if (sentiment) {
                sql += ` AND sentiment = ?`;
                params.push(sentiment);
            }
            if (urgent === 'true') {
                sql += ` AND json_extract(processed_json, '$.is_urgent') = true`;
            }
            if (from) {
                sql += ` AND created_at >= ?`;
                params.push(parseInt(from));
            }
            if (to) {
                sql += ` AND created_at <= ?`;
                params.push(parseInt(to));
            }

            sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
            params.push(limit, offset);

            const signals = this.ctx.storage.sql.exec(sql, ...params).toArray();

            // Get total count
            let countSql = `SELECT COUNT(*) as total FROM content_items WHERE is_signal = 1`;
            const total = (this.ctx.storage.sql.exec(countSql).one() as any)?.total || 0;

            const responseData = {
                signals: signals.map((s: any) => ({
                    ...s,
                    processed_json: s.processed_json ? JSON.parse(s.processed_json) : null
                })),
                total,
                limit,
                offset
            };

            // Cache unfiltered first page
            if (!query && !source && !sentiment && !urgent && !from && !to && offset === 0) {
                this.setCache('signal', responseData);
            }

            return Response.json(responseData);
        }

        // List signals (simple paginated list)
        if (url.pathname === '/signals' && request.method === 'GET') {
            const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
            const offset = parseInt(url.searchParams.get('offset') || '0');

            const signals = this.ctx.storage.sql.exec(
                `SELECT id, source_id, source_name, raw_text, processed_json, sentiment, created_at 
                 FROM content_items WHERE is_signal = 1 
                 ORDER BY created_at DESC LIMIT ? OFFSET ?`,
                limit, offset
            ).toArray();

            const total = (this.ctx.storage.sql.exec(
                `SELECT COUNT(*) as total FROM content_items WHERE is_signal = 1`
            ).one() as any)?.total || 0;

            return Response.json({
                signals: signals.map((s: any) => ({
                    ...s,
                    processed_json: s.processed_json ? JSON.parse(s.processed_json) : null
                })),
                total,
                limit,
                offset
            });
        }

        // Export signals as CSV or JSON
        if (url.pathname === '/signals/export' && request.method === 'GET') {
            const format = url.searchParams.get('format') || 'json';
            const from = url.searchParams.get('from');
            const to = url.searchParams.get('to');
            const limit = Math.min(parseInt(url.searchParams.get('limit') || '500'), 1000);

            let sql = `SELECT id, source_name, raw_text, processed_json, sentiment, created_at 
                       FROM content_items WHERE is_signal = 1`;
            const params: any[] = [];

            if (from) {
                sql += ` AND created_at >= ?`;
                params.push(parseInt(from));
            }
            if (to) {
                sql += ` AND created_at <= ?`;
                params.push(parseInt(to));
            }
            sql += ` ORDER BY created_at DESC LIMIT ?`;
            params.push(limit);

            const signals = this.ctx.storage.sql.exec(sql, ...params).toArray().map((s: any) => ({
                id: s.id,
                source: s.source_name,
                text: s.raw_text,
                sentiment: s.sentiment,
                summary: s.processed_json ? JSON.parse(s.processed_json)?.summary : '',
                relevance: s.processed_json ? JSON.parse(s.processed_json)?.relevance_score : 0,
                urgent: s.processed_json ? JSON.parse(s.processed_json)?.is_urgent : false,
                timestamp: s.created_at
            }));

            if (format === 'csv') {
                const header = 'id,source,text,sentiment,summary,relevance,urgent,timestamp\n';
                const rows = signals.map((s: any) =>
                    `"${s.id}","${s.source}","${(s.text || '').replace(/"/g, '""')}","${s.sentiment}","${(s.summary || '').replace(/"/g, '""')}",${s.relevance},${s.urgent},${s.timestamp}`
                ).join('\n');
                return new Response(header + rows, {
                    headers: {
                        'Content-Type': 'text/csv',
                        'Content-Disposition': 'attachment; filename="signals.csv"'
                    }
                });
            }

            return Response.json({ signals, exported_at: Date.now() });
        }

        // Get unique sources for filtering
        if (url.pathname === '/signals/sources' && request.method === 'GET') {
            const sources = this.ctx.storage.sql.exec(
                `SELECT DISTINCT source_name FROM content_items WHERE source_name IS NOT NULL ORDER BY source_name`
            ).toArray();
            return Response.json({ sources: sources.map((s: any) => s.source_name) });
        }

        return this.sendError('Endpoint not found', 404);
    }

    /**
     * Handles webhook-based content ingestion from Discord, Slack, etc.
     * Time Complexity: O(1) for ingestion.
     */
    private async handleWebhook(request: Request, type: 'generic' | 'discord' | 'slack'): Promise<Response> {
        if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

        try {
            const body = await request.json() as any;
            let ingestData: { chatId: string, title: string, text: string } | null = null;

            if (type === 'generic') {
                ingestData = {
                    chatId: body.source_id || 'webhook-generic',
                    title: body.source_name || 'Generic Webhook',
                    text: body.text || body.content || body.message
                };
            } else if (type === 'discord') {
                const text = [body.content, ...(body.embeds?.map((e: any) => `${e.title || ''}\n${e.description || ''}`) || [])].join('\n').trim();
                ingestData = {
                    chatId: body.channel_id || 'webhook-discord',
                    title: body.username || 'Discord Webhook',
                    text
                };
            } else if (type === 'slack') {
                if (body.type === 'url_verification') return Response.json({ challenge: body.challenge });
                if (body.event?.type === 'message' && !body.event.bot_id) {
                    ingestData = { chatId: body.team_id || 'webhook-slack', title: 'Slack Webhook', text: body.event.text };
                }
            }

            if (ingestData && ingestData.text) {
                await this.handleIngestInternal(ingestData);
                return Response.json({ success: true });
            }
            return this.sendError('Could not process payload or empty message', 400);
        } catch (e) {
            return this.sendError(e instanceof Error ? e.message : String(e));
        }
    }

    /**
     * Handles knowledge management endpoints (graph, alpha, narratives).
     */
    private async handleKnowledgeSync(request: Request, url: URL): Promise<Response> {
        if (url.pathname === '/knowledge/sync') {
            const items = this.ctx.storage.sql.exec('SELECT id, processed_json FROM content_items WHERE processed_json IS NOT NULL AND synced_to_graph = 0 LIMIT 50').toArray();
            return Response.json({ items });
        }
        if (url.pathname === '/knowledge/mark-synced') {
            const body = await request.json() as any;
            if (Array.isArray(body.ids)) {
                for (const id of body.ids) this.ctx.storage.sql.exec('UPDATE content_items SET synced_to_graph = 1 WHERE id = ?', id);
            }
            return Response.json({ success: true });
        }
        if (url.pathname === '/knowledge/graph') return this.handleGraph(request);
        if (url.pathname === '/knowledge/alpha') return this.handleAlpha(request);
        if (url.pathname === '/knowledge/narratives') return this.handleNarratives(request);

        return this.sendError('Knowledge endpoint not found', 404);
    }

    // Alpha API
    async handleAlpha(request: Request): Promise<Response> {
        if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

        // Alpha Calculation: (Importance * 0.5) + (Sentiment * 2.0) + (Velocity * 1.5)
        // We normalize on read for the leaderboard
        const alphaNodes = this.ctx.storage.sql.exec(`
            SELECT id, label, importance, sentiment_score, velocity,
            (importance * 0.5 + sentiment_score * 2.0 + velocity * 1.5) as alpha_score
            FROM graph_nodes 
            WHERE type = 'entity'
            ORDER BY alpha_score DESC 
            LIMIT 10
        `).toArray() as any[];

        return Response.json({ alphaNodes });
    }

    // Narratives API
    async handleNarratives(request: Request): Promise<Response> {
        if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

        const cached = this.getCache('narrative');
        if (cached) return Response.json(cached);

        const narratives = this.ctx.storage.sql.exec(`
            SELECT * FROM narratives 
            ORDER BY created_at DESC 
            LIMIT 5
        `).toArray() as any[];

        const responseData = {
            narratives: narratives.map(n => ({
                ...n,
                signals: JSON.parse(n.signals)
            }))
        };

        this.setCache('narrative', responseData);
        return Response.json(responseData);
    }

    // RSS Management Endpoints
    async handleRSS(request: Request, url: URL): Promise<Response> {
        if (request.method === 'GET') {
            const feeds = this.ctx.storage.sql.exec("SELECT * FROM channels WHERE type = 'rss'").toArray();
            return Response.json({ feeds });
        }

        if (request.method === 'POST') {
            const body = await request.json() as any;
            if (!body.url || !body.name) return Response.json({ error: 'Missing url or name' }, { status: 400 });

            // Validate feed
            const feed = await fetchAndParseRSS(body.url);
            if (!feed) return Response.json({ error: 'Invalid RSS feed' }, { status: 400 });

            const id = crypto.randomUUID();
            this.ctx.storage.sql.exec(
                "INSERT INTO channels (id, name, type, feed_url, created_at) VALUES (?, ?, 'rss', ?, ?)",
                id, body.name, body.url, Date.now()
            );

            // Trigger immediate poll
            this.ctx.waitUntil(this.pollRSSFeeds());

            return Response.json({ success: true, id, feedTitle: feed.title });
        }

        if (request.method === 'DELETE') {
            const id = url.searchParams.get('id');
            if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });
            this.ctx.storage.sql.exec("DELETE FROM channels WHERE id = ? AND type = 'rss'", id);
            return Response.json({ success: true });
        }

        return new Response('Method not allowed', { status: 405 });
    }

    /**
     * Phase 19: Analytics & Reporting API
     */
    private handleAnalytics(request: Request, url: URL): Response {
        if (url.pathname === '/analytics/trends') {
            // Daily signal volume (last 30 days)
            const query = `
                SELECT date(created_at / 1000, 'unixepoch') as day, COUNT(*) as count 
                FROM content_items 
                WHERE is_signal = 1
                GROUP BY day 
                ORDER BY day DESC 
                LIMIT 30
            `;
            const trends = this.ctx.storage.sql.exec(query).toArray();
            return Response.json({ trends: trends.reverse() });
        }

        if (url.pathname === '/analytics/sentiment') {
            const sentiment = this.ctx.storage.sql.exec(`
                SELECT sentiment, COUNT(*) as count 
                FROM content_items 
                WHERE is_signal = 1 
                GROUP BY sentiment
            `).toArray();
            return Response.json({ sentiment });
        }

        if (url.pathname === '/analytics/sources') {
            const sources = this.ctx.storage.sql.exec(`
                SELECT source_name, COUNT(*) as count 
                FROM content_items 
                WHERE is_signal = 1 
                GROUP BY source_name 
                ORDER BY count DESC 
                LIMIT 10
            `).toArray();
            return Response.json({ sources });
        }

        return this.sendError('Analytics endpoint not found', 404);
    }

    /**
     * Phase 22: Push Notifications API
     */
    private async handleNotifications(request: Request, url: URL): Promise<Response> {
        if (url.pathname === '/notifications/vapid-public-key') {
            return Response.json({ key: this.env.VAPID_PUBLIC_KEY });
        }

        if (request.method === 'POST' && url.pathname === '/notifications/subscribe') {
            try {
                const sub = await request.json() as any;
                if (!sub.endpoint) return this.sendError('Missing endpoint');

                this.ctx.storage.sql.exec(
                    'INSERT OR REPLACE INTO push_subscriptions (id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)',
                    sub.endpoint, sub.endpoint, sub.keys?.p256dh, sub.keys?.auth, Date.now()
                );
                return Response.json({ success: true });
            } catch (e) {
                return this.sendError('Subscription failed');
            }
        }
        return this.sendError('Notification endpoint not found', 404);
    }

    /**
     * Phase 16: Telegram Management API
     */
    private async handleTelegramRoutes(request: Request, url: URL): Promise<Response> {
        if (url.pathname === '/telegram/chats') {
            const chats = this.ctx.storage.sql.exec(`
                SELECT id, name, type, last_ingested_at, success_count 
                FROM channels 
                ORDER BY last_ingested_at DESC
            `).toArray();
            return Response.json({ chats });
        }

        if (url.pathname === '/telegram/messages') {
            const chatId = url.searchParams.get('chatId');
            if (!chatId) return this.sendError('Missing chatId parameter');

            const messages = this.ctx.storage.sql.exec(`
                SELECT * FROM content_items 
                WHERE source_id = ? 
                ORDER BY created_at DESC 
                LIMIT 50
            `, chatId).toArray();
            return Response.json({ messages });
        }

        return this.sendError('Telegram endpoint not found', 404);
    }

    /**
     * Handles health check and system statistics.
     * Time Complexity: O(1) (SQL COUNT on small/indexed tables).
     */
    private handleHealthStats(request: Request, url: URL): Response {
        if (url.pathname === '/health') return Response.json({ status: 'healthy', timestamp: new Date().toISOString() });

        const total = (this.ctx.storage.sql.exec('SELECT COUNT(*) as cnt FROM content_items').one() as any)?.cnt || 0;
        const signals = (this.ctx.storage.sql.exec('SELECT COUNT(*) as cnt FROM content_items WHERE is_signal = 1').one() as any)?.cnt || 0;
        return Response.json({ totalItems: total, signals, timestamp: new Date().toISOString() });
    }

    /**
     * Handles administrative and direct ingestion endpoints.
     */
    private async handleAdmin(request: Request, url: URL): Promise<Response> {
        if (url.pathname === '/ingest') return this.handleIngest(request);
        if (url.pathname === '/process') { await this.processBatch(); return Response.json({ success: true }); }
        if (url.pathname === '/admin/janitor') { await this.janitor(); return Response.json({ success: true }); }
        if (url.pathname === '/admin/reflect') { await this.reflect(); return Response.json({ success: true }); }
        if (url.pathname === '/sql') {
            const body = await request.json() as any;
            return Response.json({ result: this.ctx.storage.sql.exec(body.sql, ...(body.params || [])).toArray() });
        }
        return this.sendError('Admin endpoint not found', 404);
    }

    /**
     * Handles WebSocket upgrades for real-time monitoring.
     */
    private async handleWebSocket(request: Request): Promise<Response> {
        const upgradeHeader = request.headers.get('Upgrade');
        if (!upgradeHeader || upgradeHeader !== 'websocket') return new Response('Expected Upgrade: websocket', { status: 426 });

        const [client, server] = Object.values(new WebSocketPair());
        this.ctx.acceptWebSocket(server);
        return new Response(null, { status: 101, webSocket: client });
    }

    async handleIngest(request: Request): Promise<Response> {
        const body = await request.json() as any;
        const id = await this.handleIngestInternal(body);
        return Response.json({ success: true, id });
    }

    private async generateContentHash(text: string): Promise<string> {
        const msgBuffer = new TextEncoder().encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    private async handleIngestInternal(body: any): Promise<string> {
        const id = crypto.randomUUID();
        const text = body.text || '';

        // Phase 16: Slash Command Router
        if (text.startsWith('/')) {
            const response = await this.handleSlashCommand(text, body.chatId);
            // Commands return a response message instead of storing content
            console.log(`[ContentRefinery] Command executed: ${text.split(' ')[0]} -> ${response}`);
            return `cmd:${response}`;
        }

        // Deduplication: Calculate SHA-256 hash of content
        const contentHash = await this.generateContentHash(text);

        // Check if duplicate exists
        const existing = this.ctx.storage.sql.exec('SELECT id FROM content_items WHERE content_hash = ?', contentHash).toArray();
        if (existing.length > 0) {
            console.log(`[ContentRefinery] Duplicate signal detected (Hash: ${contentHash}). Skipping.`);
            return existing[0].id as string;
        }

        // Auto-register channel
        const channels = this.ctx.storage.sql.exec('SELECT id FROM channels WHERE id = ?', body.chatId).toArray();
        if (channels.length === 0) {
            this.ctx.storage.sql.exec('INSERT INTO channels (id, name, created_at) VALUES (?, ?, ?)', body.chatId, body.title, Date.now());
        }

        this.ctx.storage.sql.exec(
            'INSERT INTO content_items (id, source_id, source_name, raw_text, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            id, body.chatId, body.title, text, contentHash, Date.now()
        );

        this.invalidateCache();
        await this.ctx.storage.setAlarm(Date.now() + 5000);
        return id;
    }

    /**
     * Phase 16: Slash Command Handler
     * Routes commands to appropriate handlers.
     */
    private async handleSlashCommand(text: string, chatId: string): Promise<string> {
        const parts = text.trim().split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);

        switch (command) {
            case '/status': {
                const totalItems = (this.ctx.storage.sql.exec('SELECT COUNT(*) as cnt FROM content_items').one() as any)?.cnt || 0;
                const signals = (this.ctx.storage.sql.exec('SELECT COUNT(*) as cnt FROM content_items WHERE is_signal = 1').one() as any)?.cnt || 0;
                const channels = (this.ctx.storage.sql.exec('SELECT COUNT(*) as cnt FROM channels').one() as any)?.cnt || 0;
                return `📊 Status: ${totalItems} items, ${signals} signals, ${channels} channels`;
            }

            case '/add': {
                if (args.length < 2) return '❌ Usage: /add <name> <url>';
                const name = args[0];
                const url = args.slice(1).join(' ');
                const feedId = crypto.randomUUID();
                this.ctx.storage.sql.exec(
                    "INSERT INTO channels (id, name, type, feed_url, created_at) VALUES (?, ?, 'rss', ?, ?)",
                    feedId, name, url, Date.now()
                );
                return `✅ Added RSS feed: ${name}`;
            }

            case '/ignore': {
                if (args.length === 0) return '❌ Usage: /ignore <channel_id>';
                const targetId = args[0];
                this.ctx.storage.sql.exec('DELETE FROM channels WHERE id = ?', targetId);
                return `🔇 Ignored channel: ${targetId}`;
            }

            case '/help':
                return `📖 Commands:\n/status - System stats\n/add <name> <url> - Add RSS feed\n/ignore <id> - Remove channel`;

            default:
                return `❓ Unknown command: ${command}. Try /help`;
        }
    }

    private async pollRSSFeeds() {
        const feeds = this.ctx.storage.sql.exec("SELECT * FROM channels WHERE type = 'rss'").toArray() as any[];
        for (const feed of feeds) {
            // Rate limit: Poll every 15 mins per feed
            if (feed.last_ingested_at && Date.now() - feed.last_ingested_at < 15 * 60 * 1000) continue;

            console.log(`[ContentRefinery] Polling RSS: ${feed.name}`);
            const data = await fetchAndParseRSS(feed.feed_url);
            if (data && data.items) {
                let newCount = 0;
                for (const item of data.items) {
                    const text = `${item.title}\n\n${item.description}\n\n${item.link}`;
                    const contentHash = await this.generateContentHash(text);

                    const existing = this.ctx.storage.sql.exec('SELECT id FROM content_items WHERE content_hash = ?', contentHash).toArray();

                    if (existing.length === 0) {
                        const id = crypto.randomUUID();
                        this.ctx.storage.sql.exec(
                            'INSERT INTO content_items (id, source_id, source_name, raw_text, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                            id, feed.id, feed.name, text, contentHash, Date.now()
                        );
                        newCount++;
                    }
                }

                this.ctx.storage.sql.exec('UPDATE channels SET last_ingested_at = ?, success_count = success_count + ? WHERE id = ?', Date.now(), newCount, feed.id);
            } else {
                this.ctx.storage.sql.exec('UPDATE channels SET failure_count = failure_count + 1 WHERE id = ?', feed.id);
            }
        }
    }

    private async processBatch() {
        // Optimization: Increase batch size to 20
        const items = this.ctx.storage.sql.exec('SELECT * FROM content_items WHERE processed_json IS NULL AND retry_count < 5 LIMIT 20').toArray() as any[];
        if (items.length === 0) return;

        const bySource: Record<string, any[]> = {};
        for (const item of items) {
            if (!bySource[item.source_id]) bySource[item.source_id] = [];
            bySource[item.source_id].push(item);
        }

        for (const [sourceId, sourceItems] of Object.entries(bySource)) {
            try {
                await this.analyzeSourceBatch(sourceId, sourceItems);
            } catch (e) {
                await this.logger.log('BatchProcessor', e, { sourceId, itemCount: sourceItems.length });
            }
        }
    }

    private async analyzeSourceBatch(sourceId: string, items: any[]) {
        const texts = items.map(i => `[ID: ${i.id}] ${i.raw_text}`).join('\n---\n');
        // prompt optimization
        const systemPrompt = `Analyze market signals. Output JSON array. 
    Keys: summary, relevance_score (0-100), is_urgent (bool), sentiment, tickers (array), tags (array), signals (source_ids array), triples ({s,p,o} array). 
    Only return meaningful financial data.`;

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

                    // Phase 16: Signal Mirroring (Score > 80)
                    if (intel.relevance_score > 80) {
                        await this.mirrorSignal(intel, sourceId, items[0].source_name);
                    }

                    if (Array.isArray(intel.source_ids)) {
                        for (const sid of intel.source_ids) {
                            this.ctx.storage.sql.exec('UPDATE content_items SET is_signal = 1, tags = ? WHERE id = ?', JSON.stringify(intel.tags || []), sid);
                        }
                    }
                    // Process Triples
                    if (Array.isArray(intel.triples)) {
                        for (const triple of intel.triples) {
                            if (triple.subject && triple.predicate && triple.object) {
                                // Insert Nodes
                                this.ctx.storage.sql.exec(`INSERT OR IGNORE INTO graph_nodes (id, label, type, last_seen, sentiment_score, velocity) VALUES (?, ?, 'entity', ?, 0, 0)`, triple.subject, triple.subject, Date.now());
                                this.ctx.storage.sql.exec(`INSERT OR IGNORE INTO graph_nodes (id, label, type, last_seen, sentiment_score, velocity) VALUES (?, ?, 'entity', ?, 0, 0)`, triple.object, triple.object, Date.now());

                                // Map sentiment to score
                                let sentScore = 0;
                                if (intel.sentiment === 'positive') sentScore = 1;
                                if (intel.sentiment === 'negative') sentScore = -1;

                                // Update Node Stats (Importance, Sentiment, Velocity)
                                this.ctx.storage.sql.exec(`
                                    UPDATE graph_nodes 
                                    SET importance = importance + 0.1, 
                                        velocity = velocity + 1,
                                        sentiment_score = sentiment_score + ?,
                                        last_seen = ? 
                                    WHERE id IN (?, ?)
                                `, sentScore, Date.now(), triple.subject, triple.object);

                                // Insert/Update Edge
                                this.ctx.storage.sql.exec(`
                                    INSERT INTO graph_edges (source, target, relation, weight, last_seen) VALUES (?, ?, ?, 1.0, ?)
                                    ON CONFLICT(source, target, relation) DO UPDATE SET weight = weight + 0.5, last_seen = excluded.last_seen
                                `, triple.subject, triple.object, triple.predicate, Date.now());
                            }
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
    /**
     * Sends a standardized JSON error response.
     */
    private sendError(message: string, status = 400, data = {}): Response {
        return Response.json({ success: false, error: message, ...data }, { status });
    }

    /**
     * Janitor Pattern: Autonomous cleanup of stale data and logs.
     * Time Complexity: O(N) where N is the number of stale rows.
     */
    async janitor() {
        const now = Date.now();
        const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
        const fortnightAgo = now - 14 * 24 * 60 * 60 * 1000;

        try {
            // 1. Prune internal errors (> 7 days)
            this.ctx.storage.sql.exec('DELETE FROM internal_errors WHERE created_at < ?', weekAgo);

            // 2. Prune low-importance graph nodes (> 14 days)
            this.ctx.storage.sql.exec('DELETE FROM graph_nodes WHERE importance < 0.3 AND last_seen < ?', fortnightAgo);

            // 3. Clear expired rate limits
            const limit = now - this.RATE_LIMIT_WINDOW;
            for (const [ip, timestamps] of this.rateLimiter) {
                const valid = timestamps.filter(t => t > limit);
                if (valid.length === 0) this.rateLimiter.delete(ip);
                else this.rateLimiter.set(ip, valid);
            }

            console.log("[ContentRefinery] Janitor cleanup complete.");
        } catch (e) {
            await this.logger.log('Janitor', e);
        }
    }

    /**
     * Reflexion Pattern: Self-critique and refinement of AI outputs.
     * Samples recent signals and narratives to improve accuracy and consistency.
     */
    async reflect() {
        try {
            // 1. Sample recent signals for reflexion (limit 5 for cost control)
            const signals = this.ctx.storage.sql.exec(
                'SELECT * FROM content_items WHERE is_signal = 1 AND sentiment != "unknown" ORDER BY created_at DESC LIMIT 5'
            ).toArray();

            for (const s of signals as any[]) {
                const reflexionRes = await this.env.AI.run('@cf/meta/llama-3-8b-instruct', {
                    messages: [
                        { role: 'system', content: 'You are a critical reviewer. Analyze the previous extraction and sentiment for accuracy and objectivity.' },
                        { role: 'user', content: `Original Text: ${s.raw_text}\nPrevious Extraction: ${s.processed_json}\nCritique this extraction and provide an improved JSON if necessary.` }
                    ],
                    response_format: { type: 'json_object' }
                });

                // Update if LLM suggests a significant change (this is a simplified implementation)
                // In a production scenario, we'd compare the outputs more rigorously
                if (reflexionRes.response) {
                    // Logic to merge or update s.processed_json
                    // For now, we log the success of the reflection step
                    console.log(`[ContentRefinery] Reflected on signal ${s.id}`);
                }
            }

            console.log("[ContentRefinery] Reflexion cycle complete.");
        } catch (e) {
            await this.logger.log('Reflexion', e);
        }
    }

    /**
     * Durable Object Alarm handler - The heartbeat of the refinery.
     * Manages RSS polling, batch ingestion, narrative synthesis, and maintenance.
     */
    async alarm() {
        const now = Date.now();
        console.log('[ContentRefinery] Alarm triggered. Processing heartbeat...');

        try {
            // 1. High-Frequency: Poll RSS and Process Batches
            await this.pollRSSFeeds().catch(e => this.logger.log('RSS', e));
            await this.processBatch().catch(e => this.logger.log('Batch', e));

            // 2. Medium-Frequency: Narrative Synthesis (Every 1 hour)
            const lastNarrative = await this.ctx.storage.get<number>('last_narrative_run') || 0;
            if (now - lastNarrative > 60 * 60 * 1000) {
                await this.detectNarratives().catch(e => this.logger.log('NarrativeEngine', e));
                await this.ctx.storage.put('last_narrative_run', now);
            }

            // 3. Low-Frequency: Janitor and Reflexion (Every 12 hours)
            const lastMaintenance = await this.ctx.storage.get<number>('last_maintenance_run') || 0;
            if (now - lastMaintenance > 12 * 60 * 60 * 1000) {
                await this.janitor().catch(e => this.logger.log('Janitor', e));
                await this.reflect().catch(e => this.logger.log('Reflexion', e));
                await this.ctx.storage.put('last_maintenance_run', now);
            }

        } catch (e) {
            await this.logger.log('AlarmHeartbeat', e);
        } finally {
            // Default reschedule for polling/batching (5 minutes)
            // Note: Ingestions may trigger shorter alarms (5s) via handleIngestInternal
            const currentAlarm = await this.ctx.storage.getAlarm();
            if (currentAlarm === null || currentAlarm <= now) {
                await this.ctx.storage.setAlarm(now + 5 * 60 * 1000);
            }
        }
    }

    /**
     * Fetches the current state of the knowledge graph.
     */
    private async handleGraph(request: Request): Promise<Response> {
        if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
        const nodes = this.ctx.storage.sql.exec('SELECT * FROM graph_nodes ORDER BY importance DESC LIMIT 200').toArray();
        const nodeIds = nodes.map((n: any) => `'${n.id}'`).join(',');
        const links = nodeIds ? this.ctx.storage.sql.exec(`SELECT * FROM graph_edges WHERE source IN (${nodeIds}) AND target IN (${nodeIds}) LIMIT 500`).toArray() : [];
        return Response.json({ nodes, links });
    }

    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
        // Optional: Handle client commands (e.g. subscribe to specific tickers)
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
        ws.close(code, reason);
    }

    private isRateLimited(request: Request): boolean {
        const ip = request.headers.get('cf-connecting-ip') || 'anonymous';
        const now = Date.now();
        const timestamps = this.rateLimiter.get(ip) || [];
        const recentTimestamps = timestamps.filter(ts => now - ts < this.RATE_LIMIT_WINDOW);

        if (recentTimestamps.length >= this.RATE_LIMIT_THRESHOLD) return true;

        recentTimestamps.push(now);
        this.rateLimiter.set(ip, recentTimestamps);
        return false;
    }

    private getCache(type: 'signal' | 'narrative') {
        const cache = type === 'signal' ? this.signalCache : this.narrativeCache;
        if (cache && Date.now() - cache.timestamp < this.CACHE_TTL) return cache.data;
        return null;
    }

    private setCache(type: 'signal' | 'narrative', data: any) {
        if (type === 'signal') this.signalCache = { data, timestamp: Date.now() };
        else this.narrativeCache = { data, timestamp: Date.now() };
    }

    private invalidateCache() {
        this.signalCache = null;
        this.narrativeCache = null;
    }

    private async detectNarratives() {
        console.log('[ContentRefinery] Detecting Market Narratives...');

        // 1. Get signals from the last 12 hours
        const signals = this.ctx.storage.sql.exec(`
            SELECT id, source_name, raw_text, processed_json, created_at 
            FROM content_items 
            WHERE is_signal = 1 AND created_at > ?
        `, Date.now() - 12 * 60 * 60 * 1000).toArray() as any[];

        if (signals.length < 3) return;

        // 2. Identify clusters based on shared entities
        const clusters: any[][] = [];
        const processedIds = new Set<string>();

        for (const s of signals) {
            if (processedIds.has(s.id)) continue;

            const sIntel = JSON.parse(s.processed_json).analysis.find((a: any) => a.source_ids?.includes(s.id));
            if (!sIntel || !sIntel.triples) continue;

            const sEntities = new Set(sIntel.triples.flatMap((t: any) => [t.subject, t.object]));
            const cluster = [s];
            processedIds.add(s.id);

            for (const other of signals) {
                if (processedIds.has(other.id)) continue;
                const oIntel = JSON.parse(other.processed_json).analysis.find((a: any) => a.source_ids?.includes(other.id));
                if (!oIntel || !oIntel.triples) continue;

                const oEntities = oIntel.triples.flatMap((t: any) => [t.subject, t.object]);
                if (oEntities.some((e: string) => sEntities.has(e))) {
                    cluster.push(other);
                    processedIds.add(other.id);
                }
            }

            if (cluster.length >= 2) {
                clusters.push(cluster);
            }
        }

        // 3. For each cluster, synthesize a narrative
        for (const cluster of clusters) {
            const clusterTexts = cluster.map(c => `[${c.source_name}]: ${c.raw_text}`).join('\n\n');
            const synthesisPrompt = `You are a Senior Macro Analyst. Synthesize the following signals into a cohesive market narrative.
            Signals:
            ${clusterTexts}
            
            Output valid JSON:
            {
                "title": "Short descriptive title",
                "summary": "Cohesive summary of the narrative development",
                "sentiment": "positive" | "negative" | "neutral"
            }`;

            try {
                const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent?key=${this.env.GEMINI_API_KEY}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ role: 'user', parts: [{ text: synthesisPrompt }] }],
                            generationConfig: { temperature: 0.3, response_mime_type: "application/json" }
                        })
                    }
                );

                const res = await response.json() as any;
                const narrative = JSON.parse(res.candidates?.[0]?.content?.parts?.[0]?.text || '{}');

                if (narrative.title && narrative.summary) {
                    const id = crypto.randomUUID();
                    this.ctx.storage.sql.exec(
                        'INSERT INTO narratives (id, title, summary, sentiment, signals, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                        id, narrative.title, narrative.summary, narrative.sentiment, JSON.stringify(cluster.map(c => c.id)), Date.now()
                    );
                    this.invalidateCache();
                }
            } catch (e) {
                await this.logger.log('NarrativeEngine', e, { clusterSize: cluster.length });
            }
        }
    /**
     * Phase 16: Internal Scheduled Handler
     */
    private async handleScheduled(cron: string) {
        console.log(`[ContentRefinery] Scheduled trigger: ${cron}`);
        // Both 5AM and 5PM crons trigger the briefing
        await this.generateDailyBriefing();
    }

    /**
     * Phase 16: Daily Briefing Agent
     * Generates a market digest and sends it to the Alpha channel.
     */
    private async generateDailyBriefing() {
        const ALPHA_CHANNEL = "-1003589267081";

        try {
            // 1. Get top narratives from last 12 hours
            const narratives = this.ctx.storage.sql.exec(`
                SELECT title, summary, sentiment 
                FROM narratives 
                WHERE created_at > ? 
                ORDER BY created_at DESC LIMIT 5
            `, Date.now() - 12 * 60 * 60 * 1000).toArray() as any[];

            if (narratives.length === 0) {
                console.log("[ContentRefinery] No narratives found for briefing.");
                return;
            }

            // 2. Format message
            let message = `🔭 <b>Daily Alpha Digest</b>\n`;
            message += `<i>Refining the world's noise into market intelligence.</i>\n\n`;

            message += `🔥 <b>Top 5 Narratives:</b>\n`;
            narratives.forEach((n, i) => {
                const icon = n.sentiment === 'positive' ? '📈' : n.sentiment === 'negative' ? '📉' : '↔️';
                message += `${i + 1}. ${icon} <b>${n.title}</b>\n   <i>${n.summary}</i>\n\n`;
            });

            message += `💡 <i>Tip: Use /status in DM to check system health.</i>`;

            // 3. Send to Telegram
            const tg = await this.ensureTelegram();
            await tg.sendMessage(ALPHA_CHANNEL, message);
            console.log(`[ContentRefinery] Daily briefing sent to ${ALPHA_CHANNEL}`);

        } catch (e) {
            await this.logger.log('BriefingAgent', e);
        }
    }

    /**
     * Phase 16: Signal Mirroring
     * Forwards high-alpha signals to the Alpha channel.
     */
    private async mirrorSignal(intel: any, sourceId: string, sourceName: string) {
        const ALPHA_CHANNEL = "-1003589267081";

        try {
            const sentimentIcon = intel.sentiment === 'positive' ? '🟢' : intel.sentiment === 'negative' ? '🔴' : '⚪️';
            const urgencyIcon = intel.is_urgent ? '🚨 ' : '📡 ';

            let message = `${urgencyIcon}<b>HIGH ALPHA SIGNAL</b>\n`;
            message += `━━━━━━━━━━━━━━━\n`;
            message += `<b>Source:</b> ${sourceName}\n`;
            message += `<b>Sentiment:</b> ${sentimentIcon} ${intel.sentiment?.toUpperCase()}\n`;
            message += `<b>Relevance:</b> ⚡️ ${intel.relevance_score}%\n\n`;
            message += `📝 <b>Summary:</b> ${intel.summary}\n\n`;

            if (intel.tickers?.length > 0) {
                message += `🏷 <b>Tickers:</b> ${intel.tickers.map((t: string) => `$${t}`).join(' ')}\n`;
            }

            const tg = await this.ensureTelegram();
            await tg.sendMessage(ALPHA_CHANNEL, message);
            console.log(`[ContentRefinery] Signal mirrored to ${ALPHA_CHANNEL}`);
        } catch (e) {
            await this.logger.log('SignalMirror', e);
        }
    }
}
