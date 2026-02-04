import { ContentItem } from './types';

/**
 * FactStore: A minimalist persistence layer for the Alpha Pipe.
 */
export class FactStore {
    private counters = { items: 0, signals: 0, channels: 0 };
    private initialized = false;

    constructor(private storage: DurableObjectStorage) { }

    private ensureInitialized() {
        if (this.initialized) return;
        const items = this.storage.sql.exec('SELECT COUNT(*) as cnt FROM content_items').toArray()[0] as any;
        const signals = this.storage.sql.exec('SELECT COUNT(*) as cnt FROM content_items WHERE is_signal = 1').toArray()[0] as any;
        this.counters.items = items?.cnt || 0;
        this.counters.signals = signals?.cnt || 0;
        this.initialized = true;
    }

    async saveContentItem(item: Partial<ContentItem> & { id: string }) {
        this.ensureInitialized();
        const existing = this.storage.sql.exec('SELECT is_signal FROM content_items WHERE id = ?', item.id).toArray()[0] as any;

        this.storage.sql.exec(`
            INSERT OR REPLACE INTO content_items (
                id, source_id, source_name, raw_text, processed_json, 
                is_signal, created_at, content_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, 
            item.id, item.source_id || null, item.source_name || null, item.raw_text || '',
            item.processed_json ? JSON.stringify(item.processed_json) : null,
            item.is_signal || 0, item.created_at || Date.now(), item.metadata?.content_hash || null
        );

        if (!existing) {
            this.counters.items++;
            if (item.is_signal === 1) this.counters.signals++;
        } else if (existing.is_signal === 0 && item.is_signal === 1) {
            this.counters.signals++;
        }
    }

    existsByHash(hash: string): string | null {
        const row = this.storage.sql.exec('SELECT id FROM content_items WHERE content_hash = ? LIMIT 1', hash).toArray()[0] as any;
        return row ? row.id : null;
    }

    logState(module: string, message: string, context: any = null) {
        this.storage.sql.exec(
            'INSERT INTO internal_errors (id, module, message, context, created_at) VALUES (?, ?, ?, ?, ?)',
            crypto.randomUUID(), module, message, context ? JSON.stringify(context) : null, Date.now()
        );
    }

    getStats() {
        this.ensureInitialized();
        return { ...this.counters };
    }
}
