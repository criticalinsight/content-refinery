import { ContentItem } from './types';

/**
 * FactStore unentangles persistence logic from business logic.
 * It treats the SQLite database as an immutable fact store where possible,
 * providing a clean API for storage and retrieval.
 */
export class FactStore {
    constructor(private storage: DurableObjectStorage) { }

    /**
     * Records a new content item (Fact) in the store.
     */
    async saveContentItem(item: Partial<ContentItem> & { id: string }) {
        const sql = `
            INSERT OR REPLACE INTO content_items (
                id, source_id, source_name, raw_text, processed_json, 
                sentiment, is_signal, created_at, content_hash, tags, last_analyzed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        this.storage.sql.exec(
            sql,
            item.id,
            item.source_id || null,
            item.source_name || null,
            item.raw_text || '',
            item.processed_json ? JSON.stringify(item.processed_json) : null,
            item.sentiment || null,
            item.is_signal || 0,
            item.created_at || Date.now(),
            item.metadata?.content_hash || null,
            item.metadata?.tags ? JSON.stringify(item.metadata.tags) : null,
            item.last_analyzed_at || null
        );
    }

    /**
     * Checks for recent (24h) analysis of identical content.
     */
    getRecentAnalysisByHash(hash: string): any | null {
        const cutoff = Date.now() - (24 * 60 * 60 * 1000);
        const row = this.storage.sql.exec(
            'SELECT processed_json FROM content_items WHERE content_hash = ? AND processed_json IS NOT NULL AND last_analyzed_at > ? LIMIT 1',
            hash,
            cutoff
        ).toArray()[0] as any;

        return row ? JSON.parse(row.processed_json) : null;
    }

    /**
     * Retrieves a content item by ID.
     */
    getItem(id: string): ContentItem | null {
        const row = this.storage.sql.exec('SELECT * FROM content_items WHERE id = ?', id).toArray()[0] as any;
        if (!row) return null;

        return {
            ...row,
            processed_json: row.processed_json ? JSON.parse(row.processed_json) : null,
            metadata: {
                content_hash: row.content_hash,
                tags: row.tags ? JSON.parse(row.tags) : []
            },
            last_analyzed_at: row.last_analyzed_at
        };
    }

    /**
     * Lists processed signals with pagination.
     */
    listSignals(limit: number = 50, offset: number = 0): ContentItem[] {
        const rows = this.storage.sql.exec(
            'SELECT * FROM content_items WHERE is_signal = 1 ORDER BY created_at DESC LIMIT ? OFFSET ?',
            limit,
            offset
        ).toArray() as any[];

        return rows.map(row => ({
            ...row,
            processed_json: row.processed_json ? JSON.parse(row.processed_json) : null
        }));
    }

    /**
     * Logs internal system state changes (previously internal_errors).
     */
    logState(module: string, message: string, context: any = null) {
        this.storage.sql.exec(
            'INSERT INTO internal_errors (id, module, message, context, created_at) VALUES (?, ?, ?, ?, ?)',
            crypto.randomUUID(),
            module,
            message,
            context ? JSON.stringify(context) : null,
            Date.now()
        );
    }

    /**
     * Aggregates system metrics for the /status command.
     */
    getStats(): { items: number, signals: number, channels: number } {
        const totalItems = (this.storage.sql.exec('SELECT COUNT(*) as cnt FROM content_items').toArray()[0] as any)?.cnt || 0;
        const signals = (this.storage.sql.exec('SELECT COUNT(*) as cnt FROM content_items WHERE is_signal = 1').toArray()[0] as any)?.cnt || 0;
        const channels = (this.storage.sql.exec('SELECT COUNT(*) as cnt FROM channels').toArray()[0] as any)?.cnt || 0;
        return { items: totalItems, signals, channels };
    }

    /**
     * Removes a channel from the watch list.
     */
    deleteChannel(id: string) {
        this.storage.sql.exec('DELETE FROM channels WHERE id = ?', id);
    }
}
