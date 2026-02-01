import { DurableObjectState } from '@cloudflare/workers-types';
import { fetchAndParseRSS } from '../utils/rss';
import { generateContentHash } from '../utils/crypto';

export class RSSCollector {
    constructor(private storage: DurableObjectStorage) { }

    async pollAll() {
        const feeds = this.storage.sql.exec("SELECT * FROM channels WHERE type = 'rss' AND status != 'ignored'").toArray() as any[];

        for (const feed of feeds) {
            // Rate limit: Poll every 15 mins per feed
            if (feed.last_ingested_at && Date.now() - feed.last_ingested_at < 15 * 60 * 1000) continue;

            console.log(`[RSSCollector] Polling RSS: ${feed.name}`);
            const data = await fetchAndParseRSS(feed.feed_url);

            if (data && data.items) {
                let newCount = 0;
                for (const item of data.items) {
                    const text = `${item.title}\n\n${item.description}\n\n${item.link}`;
                    const contentHash = await generateContentHash(text);

                    const existing = this.storage.sql.exec('SELECT id FROM content_items WHERE content_hash = ?', contentHash).toArray();

                    if (existing.length === 0) {
                        const id = crypto.randomUUID();
                        this.storage.sql.exec(
                            'INSERT INTO content_items (id, source_id, source_name, raw_text, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                            id, feed.id, feed.name, text, contentHash, Date.now()
                        );
                        newCount++;
                    }
                }

                this.storage.sql.exec('UPDATE channels SET last_ingested_at = ?, success_count = success_count + ? WHERE id = ?', Date.now(), newCount, feed.id);
            } else {
                this.storage.sql.exec('UPDATE channels SET failure_count = failure_count + 1 WHERE id = ?', feed.id);
            }
        }
    }
}
