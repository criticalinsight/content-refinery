import { FactStore } from '../FactStore';
import { Env } from '../types';

export class AdminService {
    constructor(
        private store: FactStore,
        private env: Env,
        private storage: DurableObjectStorage,
        private orchestrator: any
    ) { }

    async dispatch(request: Request, url: URL): Promise<Response> {
        try {
            if (url.pathname === '/admin/status' || url.pathname === '/health' || url.pathname === '/stats') {
                return Response.json({ status: 'online', metrics: this.store.getStats() });
            }

            if (url.pathname === '/admin/reset-processing') {
                this.storage.sql.exec('UPDATE content_items SET processed_json = NULL, is_signal = 0');
                this.storage.sql.exec('DELETE FROM internal_errors');
                return Response.json({ success: true, message: 'Queue and logic logs reset' });
            }

            if (url.pathname === '/admin/settings') {
                if (request.method === 'GET') {
                    const settings = this.storage.sql.exec("SELECT * FROM settings").toArray();
                    const map: any = {};
                    for (const row of settings as any[]) map[row.key] = JSON.parse(row.value);
                    return Response.json({ settings: map });
                }
                if (request.method === 'POST') {
                    const { key, value } = await request.json() as any;
                    this.storage.sql.exec("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)", key, JSON.stringify(value), Date.now());
                    return Response.json({ success: true });
                }
            }

            if (url.pathname === '/admin/reprocess-last') {
                const count = parseInt(url.searchParams.get('count') || '100');

                // Warm up Telegram cache
                try {
                    const tg = await this.orchestrator.telegram.ensureConnection();
                    await tg.getClient().getDialogs({ limit: 100 });
                    console.log("[Admin] Telegram cache warmed up with 100 dialogs.");
                } catch (e) {
                    console.error("[Admin] Failed to warm up Telegram cache:", e);
                }

                const rows = this.storage.sql.exec(
                    'SELECT id FROM content_items ORDER BY created_at DESC LIMIT ?',
                    count
                ).toArray() as any[];

                const results = { successful: 0, failed: 0 };
                for (const row of rows) {
                    const ok = await this.orchestrator.reprocess(row.id, {
                        scrub: async (t: string) => t,
                        analyzeImage: async (b: any) => "[IMAGE]",
                        transcribeAudio: async (b: any) => "[AUDIO]"
                    });
                    if (ok) results.successful++;
                    else results.failed++;
                }
                return Response.json({ success: true, count: rows.length, results });
            }

            if (url.pathname === '/admin/digest') {
                const { sourceIds } = await request.json() as { sourceIds: string[] };
                const results = { successful: 0, failed: 0 };

                for (const id of sourceIds) {
                    const ok = await this.orchestrator.reprocess(id, {
                        scrub: async (t: string) => t,
                        analyzeImage: async (b: any) => "[IMAGE]",
                        transcribeAudio: async (b: any) => "[AUDIO]"
                    });
                    if (ok) results.successful++;
                    else results.failed++;
                }
                return Response.json({ success: true, results });
            }

            if (url.pathname === '/admin/debug/list-pdfs') {
                const rows = this.storage.sql.exec("SELECT id, source_name, source_id, raw_text FROM content_items WHERE raw_text LIKE '%[PDF DOCUMENT]%' LIMIT 10").toArray();
                return Response.json({ pdfs: rows });
            }

            if (url.pathname === '/admin/debug/logs') {
                const logs = this.storage.sql.exec("SELECT * FROM internal_errors ORDER BY created_at DESC LIMIT 20").toArray();
                return Response.json({ logs });
            }

            if (url.pathname === '/admin/debug/test-pdf') {
                const { analyzePDF } = await import('../logic/engine');
                const samplePdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 226, 227, 207, 211, 10, 49, 32, 48, 32, 111, 98, 106, 10, 60, 60, 47, 84, 121, 112, 101, 47, 67, 97, 116, 97, 108, 111, 103, 47, 80, 97, 103, 101, 115, 32, 50, 32, 48, 32, 82, 62, 62, 10, 101, 110, 100, 111, 98, 106, 10, 50, 32, 48, 32, 111, 98, 106, 10, 60, 60, 47, 84, 121, 112, 101, 47, 80, 97, 103, 101, 115, 47, 75, 105, 100, 115, 91, 51, 32, 48, 32, 82, 93, 47, 67, 111, 117, 110, 116, 32, 49, 62, 62, 10, 101, 110, 100, 111, 98, 106, 10, 51, 32, 48, 32, 111, 98, 106, 10, 60, 60, 47, 84, 121, 112, 101, 47, 80, 97, 103, 101, 47, 80, 97, 114, 101, 110, 116, 32, 50, 32, 48, 32, 82, 47, 77, 101, 100, 105, 97, 66, 111, 120, 91, 48, 32, 48, 32, 54, 49, 50, 32, 55, 57, 50, 93, 47, 67, 111, 110, 116, 101, 110, 116, 115, 32, 52, 32, 48, 32, 82, 47, 82, 101, 115, 111, 117, 114, 99, 101, 115, 60, 60, 62, 62, 62, 62, 10, 101, 110, 100, 111, 98, 106, 10, 52, 32, 48, 32, 111, 98, 106, 10, 60, 60, 47, 76, 101, 110, 103, 116, 104, 32, 50, 49, 62, 62, 10, 115, 116, 114, 101, 97, 109, 10, 66, 84, 32, 47, 70, 49, 32, 49, 50, 32, 84, 102, 32, 48, 32, 45, 49, 51, 32, 84, 68, 32, 40, 84, 101, 115, 116, 32, 83, 105, 103, 110, 97, 108, 41, 32, 84, 106, 32, 69, 84, 10, 101, 110, 100, 115, 116, 114, 101, 97, 109, 10, 101, 110, 100, 111, 98, 106, 10, 120, 114, 101, 102, 10, 48, 32, 53, 10, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 32, 54, 53, 53, 51, 53, 32, 102, 10, 48, 48, 48, 48, 48, 48, 48, 48, 49, 53, 32, 48, 48, 48, 48, 48, 32, 110, 10, 48, 48, 48, 48, 48, 48, 48, 48, 55, 55, 32, 48, 48, 48, 48, 48, 32, 110, 10, 48, 48, 48, 48, 48, 48, 48, 49, 52, 56, 32, 48, 48, 48, 48, 48, 32, 110, 10, 48, 48, 48, 48, 48, 48, 48, 50, 54, 49, 32, 48, 48, 48, 48, 48, 32, 110, 10, 116, 114, 97, 105, 108, 101, 114, 10, 60, 60, 47, 83, 105, 122, 101, 32, 53, 47, 88, 101, 102, 32, 56, 32, 48, 32, 82, 47, 82, 111, 111, 116, 32, 49, 32, 48, 32, 82, 62, 62, 10, 115, 116, 97, 114, 116, 120, 114, 101, 102, 10, 51, 51, 51, 10, 37, 37, 69, 79, 70, 10]);

                const signals = await analyzePDF(this.env.GEMINI_API_KEY, samplePdf, "Mock Test");
                return Response.json({ signals });
            }

            if (url.pathname === '/admin/audit/recover-missed') {
                const execute = url.searchParams.get('execute') === 'true';
                const days = parseInt(url.searchParams.get('days') || '3');
                const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);

                // 1. Get all potential high signals
                const candidates = this.storage.sql.exec(
                    `SELECT * FROM content_items WHERE is_signal = 1 AND created_at > ?`,
                    cutoff
                ).toArray() as any[];

                // Filter for high relevance (score >= 80)
                const highValue = candidates.filter(c => {
                    try {
                        const json = typeof c.processed_json === 'string' ? JSON.parse(c.processed_json) : c.processed_json;
                        return json && Number(json.relevance_score) >= 80;
                    } catch (e) { return false; }
                });

                // 2. Get all successful mirror logs to find which IDs were already sent
                const logs = this.storage.sql.exec(
                    `SELECT message FROM internal_errors WHERE module = 'ORCHESTRATOR' AND message LIKE 'Signal mirrored to Alpha:%' AND created_at > ?`,
                    cutoff
                ).toArray() as any[];

                const mirroredIds = new Set<string>();
                logs.forEach(l => {
                    const match = l.message.match(/Signal mirrored to Alpha: (.*)/);
                    if (match && match[1]) mirroredIds.add(match[1].trim());
                });

                // 3. Diff -> Find missed
                const missed = highValue.filter(c => !mirroredIds.has(c.id));

                const results = {
                    total_high_value: highValue.length,
                    already_mirrored_count: mirroredIds.size,
                    missed_count: missed.length,
                    missed_items: missed.map(m => ({ id: m.id, title: m.source_name })),
                    status: execute ? 'RECOVERING...' : 'DRY_RUN'
                };

                // 4. Execute Recovery
                if (execute) {
                    for (const item of missed) {
                        try {
                            const json = typeof item.processed_json === 'string' ? JSON.parse(item.processed_json) : item.processed_json;
                            const title = `[RECOVERED] ${item.source_name || 'Signal'}`;
                            await this.orchestrator.mirrorSignal(json, item.id, title);
                        } catch (e: any) {
                            console.error(`Failed to recover ${item.id}`, e);
                        }
                    }
                }

                return Response.json(results);
            }

            if (url.pathname === '/admin/debug/test-send') {
                const text = url.searchParams.get('text') || "🔔 <b>Test Signal</b>: Infrastructure verification successful.";
                const target = this.env.ALPHA_CHANNEL_ID || "-1003589267081";
                await this.orchestrator.telegram.sendMessage(target, text);
                return Response.json({ success: true, target, text });
            }

            if (url.pathname === '/admin/debug/inspect-item') {
                const id = url.searchParams.get('id');
                if (!id) return new Response('ID required', { status: 400 });
                const item = this.store.getItem(id);
                return Response.json({ item });
            }

            return new Response('Admin endpoint not found', { status: 404 });
        } catch (e: any) {
            return Response.json({ error: e.message, stack: e.stack }, { status: 500 });
        }
    }
}
