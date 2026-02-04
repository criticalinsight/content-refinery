import { Env } from '../types';
import { FactStore } from '../FactStore';
import { TelegramCollector } from '../collectors/TelegramCollector';
import { synthesizeBatch } from './engine';
import { generateContentHash } from '../utils/crypto';

/**
 * AlphaPipe implements the core "Alpha Pipe" architecture.
 * It is a streamlined, uncomplected flow from Input to Insight to Output.
 */
export class AlphaPipe {
    constructor(
        private store: FactStore,
        private telegram: TelegramCollector,
        private env: Env,
        private storage: DurableObjectStorage
    ) {}

    /**
     * The heart of the refinery: Ingest -> Analyze -> Mirror.
     */
    async processIngest(body: any): Promise<string | null> {
        const text = body.text || '';
        if (!text || text.startsWith('/')) return null;

        const contentHash = await generateContentHash(text);
        const existingId = this.store.existsByHash(contentHash);
        if (existingId) return existingId;

        const id = crypto.randomUUID();
        const sourceId = JSON.stringify({ chatId: body.chatId, messageId: body.messageId });
        
        // Save raw item
        await this.store.saveContentItem({
            id,
            source_id: sourceId,
            source_name: body.title || 'Unknown',
            raw_text: text,
            metadata: { content_hash: contentHash }
        });

        // Trigger Analysis if length is sufficient
        if (text.length > 50) {
            try {
                const analysis = await synthesizeBatch(this.env.GEMINI_API_KEY, [{ id, raw_text: text }]);
                for (const sig of analysis) {
                    if (Number(sig.relevance_score) >= 70) {
                        const signalId = crypto.randomUUID();
                        await this.store.saveContentItem({
                            id: signalId,
                            source_id: id,
                            source_name: "Alpha Pipe Analysis",
                            raw_text: sig.analysis,
                            processed_json: sig,
                            is_signal: 1
                        });

                        if (Number(sig.relevance_score) >= 80) {
                            await this.mirrorSignal(sig);
                        }
                    }
                }
            } catch (e) {
                console.error('[AlphaPipe] Analysis failed:', e);
            }
        }

        return id;
    }

    private async mirrorSignal(signal: any) {
        const targetId = this.env.ALPHA_CHANNEL_ID || "-1003589267081";
        const sentimentEmoji = signal.sentiment === 'bullish' ? '🟢' : signal.sentiment === 'bearish' ? '🔴' : '⚪️';
        
        let msg = `📌 <b>tl;dr take</b>\n\n` +
            `${signal.analysis}\n\n` +
            `<b>Sentiment:</b> ${sentimentEmoji} ${signal.sentiment?.toUpperCase()}\n` +
            `<b>Relevance:</b> ${signal.relevance_score}%\n`;

        if (signal.tickers && signal.tickers.length > 0) {
            msg += `<b>Tickers:</b> ${signal.tickers.join(', ')}\n`;
        }

        if (signal.fact_check) {
            msg += `\n<b>Audit:</b> <i>${signal.fact_check}</i>`;
        }

        // Limit to 4000 chars
        if (msg.length > 4000) {
            msg = msg.substring(0, 3997) + '...';
        }

        try {
            await this.telegram.sendMessage(targetId, msg);
        } catch (e) {
            console.error('[AlphaPipe] Mirror failed:', e);
        }
    }
}
