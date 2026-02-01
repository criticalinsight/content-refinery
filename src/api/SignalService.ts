import { FactStore } from '../FactStore';
import { Env, ContentItem } from '../types';

export class SignalService {
    constructor(private store: FactStore, private env: Env, private storage: DurableObjectStorage) { }

    async handleSearch(url: URL, utils: { generateEmbeddings: (t: string) => Promise<number[] | null> }): Promise<Response> {
        const query = url.searchParams.get('q') || '';
        const source = url.searchParams.get('source');
        const sentiment = url.searchParams.get('sentiment');
        const urgent = url.searchParams.get('urgent');
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
        const offset = parseInt(url.searchParams.get('offset') || '0');

        // Path-based routing within Service
        if (url.pathname === '/search/vector') {
            if (!query) return new Response('Query required', { status: 400 });
            const vec = await utils.generateEmbeddings(query);
            if (!vec) return new Response('Embedding failed', { status: 500 });
            const matches = await this.env.VECTOR_INDEX.query(vec, { topK: 10, returnMetadata: true });
            return Response.json({ matches });
        }

        let sql = `SELECT id, source_id, source_name, raw_text, processed_json, sentiment, created_at 
                   FROM content_items WHERE is_signal = 1`;
        const params: any[] = [];

        if (query) { sql += ` AND raw_text LIKE ?`; params.push(`%${query}%`); }
        if (source) { sql += ` AND source_name = ?`; params.push(source); }
        if (sentiment) { sql += ` AND sentiment = ?`; params.push(sentiment); }
        if (urgent === 'true') sql += ` AND json_extract(processed_json, '$.is_urgent') = true`;
        if (from) { sql += ` AND created_at >= ?`; params.push(parseInt(from)); }
        if (to) { sql += ` AND created_at <= ?`; params.push(parseInt(to)); }

        sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const signals = this.storage.sql.exec(sql, ...params).toArray();
        const total = (this.storage.sql.exec(`SELECT COUNT(*) as total FROM content_items WHERE is_signal = 1`).toArray()[0] as any)?.total || 0;

        return Response.json({
            signals: signals.map((s: any) => ({
                ...s,
                processed_json: s.processed_json ? JSON.parse(s.processed_json) : null
            })),
            total, limit, offset
        });
    }

    async handleExport(format: string): Promise<Response> {
        return new Response('Export Not Implemented in v1.7', { status: 501 });
    }
}
