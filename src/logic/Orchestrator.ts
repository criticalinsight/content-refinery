import { Env } from '../types';
import { TelegramCollector } from '../collectors/TelegramCollector';
import { RSSCollector } from '../collectors/RSSCollector';
import { WebhookCollector } from '../collectors/WebhookCollector';
import { FactStore } from '../FactStore';
import { ErrorLogger } from '../ErrorLogger';
import { synthesizeBatch, analyzePDF } from './engine';
import { generateContentHash } from '../utils/crypto';
import { PredictiveEngine, Prediction } from './PredictiveEngine';

/**
 * Orchestrator coordinates the data flow between IO and Business Logic.
 * It is the 'Brain' that decides when to ingest, deduplicate, and route commands.
 */
export class Orchestrator {
    private predictive: PredictiveEngine;

    constructor(
        private store: FactStore,
        private logger: ErrorLogger,
        public telegram: TelegramCollector,
        private rss: RSSCollector,
        private webhooks: WebhookCollector,
        private env: Env,
        private storage: DurableObjectStorage
    ) {
        this.predictive = new PredictiveEngine(storage);
    }

    /**
     * Central ingestion pipeline.
     */
    async processIngest(body: any, utils: {
        scrub: (t: string) => Promise<string | null>,
        analyzeImage: (b: Uint8Array) => Promise<string>,
        transcribeAudio: (b: Uint8Array) => Promise<string>
    }, options: { forceAnalysis?: boolean, id?: string } = {}): Promise<string | null> {
        // Prevent feedback loop from output channel
        if (body.title && /high\s*signal\s*alpha/i.test(body.title)) {
            console.log('[Orchestrator] Skipping ingestion from output channel:', body.title);
            return null;
        }

        const id = options.id || crypto.randomUUID();
        let text = body.text || '';

        // Scrubbing / Privacy Filter
        const scrubbed = await utils.scrub(text);
        if (scrubbed === null) return null;
        text = scrubbed;

        // Media Processing
        if (body.media) {
            try {
                const media = body.media.media;
                const doc = media?.document;
                const isPDF = doc?.mimeType === 'application/pdf' ||
                    doc?.attributes?.some((a: any) => a.fileName?.toLowerCase().endsWith('.pdf'));

                if (isPDF) {
                    if (options.forceAnalysis) {
                        console.log("[Orchestrator] 📄 PDF detected. Downloading and Analyzing (Forced)...");
                        const tg = await this.telegram.ensureConnection();
                        const buffer = await tg.downloadMedia(body.media);
                        if (buffer) {
                            const pdfAnalysis = await analyzePDF(this.env.GEMINI_API_KEY, new Uint8Array(buffer), text);
                            // Convert analysis to text or signals
                            const summary = pdfAnalysis.map(a => `[SIGNAL] ${a.summary}`).join('\n');
                            text = (text ? text + '\n' : '') + summary;

                            // Re-store signal items
                            for (const sig of pdfAnalysis) {
                                if (sig.relevance_score > 70) {
                                    const signalId = crypto.randomUUID();
                                    await this.store.saveContentItem({
                                        id: signalId,
                                        source_id: body.messageId?.toString(),
                                        source_name: "PDF Analysis",
                                        raw_text: sig.summary,
                                        processed_json: sig,
                                        is_signal: 1,
                                        last_analyzed_at: Date.now()
                                    });

                                    // Mirror to Alpha Channel (10-sentence summary)
                                    const score = Number(sig.relevance_score);
                                    if (score >= 80 || (score >= 60 && this.env.BETA_CHANNEL_ID)) {
                                        await this.mirrorSignal(sig, signalId);
                                    } else {
                                        this.logger.logState("ORCHESTRATOR", "Mirror skipped", { signalId, score });
                                    }
                                }
                            }
                            this.logger.logState("ORCHESTRATOR", `PDF signals extracted: ${pdfAnalysis.length}`, { id });
                        }
                    } else {
                        console.log("[Orchestrator] 📄 PDF detected. Marking for background processing.");
                        text = (text ? text + '\n' : '') + "[PDF DOCUMENT]";
                    }
                } else {
                    const tg = await this.telegram.ensureConnection();
                    const buffer = await tg.downloadMedia(body.media);
                    if (buffer) {
                        if (media?.photo || media?.className === 'MessageMediaPhoto') {
                            const ocrText = await utils.analyzeImage(new Uint8Array(buffer));
                            const scrubbedOcr = await utils.scrub(ocrText);
                            if (scrubbedOcr) text = (text ? text + '\n' : '') + scrubbedOcr;
                        } else {
                            const audioText = await utils.transcribeAudio(new Uint8Array(buffer));
                            const scrubbedAudio = await utils.scrub(audioText);
                            if (scrubbedAudio) text = (text ? text + '\n' : '') + scrubbedAudio;
                        }
                    }
                }
            } catch (e) {
                console.error("[Orchestrator] Media processing failed:", e);
            }
        }

        if (!text) return "no_content";

        // Phase 21: Forced Analysis for non-PDFs (PDFs are handled above)
        const isPDF = body.media?.media?.document?.mimeType === 'application/pdf';
        if (options.forceAnalysis && !isPDF && text.length > 50) {
            console.log("[Orchestrator] 🔍 Analysis (Forced)...");
            try {
                const analysis = await synthesizeBatch(this.env.GEMINI_API_KEY, [{ id, raw_text: text }]);
                for (const sig of analysis) {
                    const score = Number(sig.relevance_score);
                    if (score > 70) {
                        const signalId = crypto.randomUUID();
                        await this.store.saveContentItem({
                            id: signalId,
                            source_id: id,
                            source_name: "Retrospective Analysis",
                            raw_text: sig.summary,
                            processed_json: sig,
                            is_signal: 1,
                            last_analyzed_at: Date.now()
                        });

                        if (sig.relevance_score >= 80 || (Number(sig.relevance_score) >= 60 && this.env.BETA_CHANNEL_ID)) {
                            await this.mirrorSignal(sig, signalId, "RETRO ALPHA");
                        }
                    }
                }
                this.logger.logState("ORCHESTRATOR", `Text signals extracted for ${id}`, { count: analysis.length });
                // Mark the original item as processed so it's not picked up again by background loop
                this.storage.sql.exec('UPDATE content_items SET is_signal = 1 WHERE id = ?', id);
            } catch (e: any) {
                console.error("[Orchestrator] Continuous analysis failed:", e);
                this.logger.logState("ORCHESTRATOR_ANALYSIS_ERROR", `Analysis failed: ${e.message}`, { id });
            }
        }

        // Slash Commands
        if (text.startsWith('/')) {
            return await this.handleSlashCommand(text, body.chatId);
        }

        // Callback Routing (from interaction buttons)
        if (text.startsWith('CALLBACK:')) {
            return await this.handleCallback(text, body.chatId);
        }

        // Deduplication and Storage (Atomic)
        const contentHash = await generateContentHash(text);

        // Phase 2: AI Deduplication Check
        const recentAnalysis = this.store.getRecentAnalysisByHash(contentHash);
        if (recentAnalysis && !options.forceAnalysis) {
            console.log(`[Orchestrator] ♻️ Reusing recent analysis for hash: ${contentHash}`);
            for (const sig of [recentAnalysis]) { // Reuse cached structure
                const signalId = crypto.randomUUID();
                await this.store.saveContentItem({
                    id: signalId,
                    source_id: id,
                    source_name: "Cached Analysis",
                    raw_text: sig.summary,
                    processed_json: sig,
                    is_signal: 1,
                    last_analyzed_at: Date.now()
                });
                if (sig.relevance_score >= 80 || (Number(sig.relevance_score) >= 60 && this.env.BETA_CHANNEL_ID)) {
                    await this.mirrorSignal(sig, signalId, "CACHED ALPHA");
                }
            }
            return id;
        }

        const existing = this.storage.sql.exec('SELECT id FROM content_items WHERE content_hash = ?', contentHash).toArray();

        // If we have an existing ID in options, we are likely updating/reprocessing it
        if (options.id) {
            this.storage.sql.exec(
                'UPDATE content_items SET raw_text = ?, content_hash = ?, source_name = ? WHERE id = ?',
                text, contentHash, body.title || 'Unknown', options.id
            );
            return options.id;
        }

        if (existing.length > 0) return existing[0].id as string;

        const sourceId = JSON.stringify({ chatId: body.chatId, messageId: body.messageId });
        this.storage.sql.exec(
            'INSERT OR REPLACE INTO content_items (id, source_id, source_name, raw_text, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            id, sourceId, body.title || 'Unknown', text, contentHash, Date.now()
        );
        return id;
    }

    /**
     * Periodic heartbeat (triggered by alarm).
     */
    async tick(): Promise<{ active: boolean }> {
        console.log('[Orchestrator] Heartbeat tick...');
        const pendingProcessed = await this.processPendingItems();
        const rssPolled = await this.pollRSS();
        await this.janitor();
        await this.reflect();

        const digestGenerated = await this.generateFinancialDigest();

        const predictions = await this.predictive.tick();
        for (const pred of predictions) {
            await this.mirrorPrediction(pred);
        }

        const active = pendingProcessed || rssPolled || digestGenerated || predictions.length > 0;
        return { active };
    }

    private async processPendingItems(): Promise<boolean> {
        const pending = this.storage.sql.exec(
            "SELECT id FROM content_items WHERE (raw_text = '[PDF DOCUMENT]' AND processed_json IS NULL) OR is_signal = 0 LIMIT 5"
        ).toArray() as any[];

        if (pending.length === 0) return false;

        for (const item of pending) {
            await this.reprocess(item.id, {
                scrub: async (t: string) => t,
                analyzeImage: async (b: any) => "[IMAGE]",
                transcribeAudio: async (b: any) => "[AUDIO]"
            });
        }
        return true;
    }

    private async pollRSS(): Promise<boolean> {
        return await this.rss.pollAll();
    }

    private async janitor(): Promise<void> {
        const threshold = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days
        this.storage.sql.exec('DELETE FROM internal_errors WHERE created_at < ?', threshold);
        // Additional cleanup logic...
    }

    private async reflect(): Promise<void> {
        // Self-critique logic...
    }

    private async generateFinancialDigest(): Promise<boolean> {
        console.log('[Orchestrator] Generating Financial Digest...');

        // Get high-value raw items from the last 24 hours
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const items = this.storage.sql.exec(
            'SELECT id, raw_text, content_hash FROM content_items WHERE created_at > ? AND is_signal = 0 LIMIT 15',
            cutoff
        ).toArray() as any[];

        if (items.length < 3) {
            console.log('[Orchestrator] Not enough data for a robust digest.');
            return false;
        }

        // Deduplication in batch
        const toAnalyze: any[] = [];
        let repurposed = 0;

        for (const item of items) {
            const cached = item.content_hash ? this.store.getRecentAnalysisByHash(item.content_hash) : null;
            if (cached) {
                const signalId = crypto.randomUUID();
                await this.store.saveContentItem({
                    id: signalId,
                    source_id: 'batch_digest_cached',
                    source_name: "Financial Digest (Cached)",
                    raw_text: cached.summary,
                    processed_json: cached,
                    is_signal: 1,
                    last_analyzed_at: Date.now()
                });
                repurposed++;
            } else {
                toAnalyze.push(item);
            }
        }

        try {
            if (toAnalyze.length > 0) {
                const batchAnalysis = await synthesizeBatch(this.env.GEMINI_API_KEY, toAnalyze);

                for (const signal of batchAnalysis) {
                    const signalId = crypto.randomUUID();
                    await this.store.saveContentItem({
                        id: signalId,
                        source_id: 'batch_extraction',
                        source_name: "Financial Engine",
                        raw_text: signal.summary,
                        processed_json: signal,
                        is_signal: 1,
                        last_analyzed_at: Date.now()
                    });

                    // Update parent items consumed by this signal
                    if (Array.isArray(signal.signals)) {
                        for (const parentId of signal.signals) {
                            this.storage.sql.exec('UPDATE content_items SET last_analyzed_at = ? WHERE id = ?', Date.now(), parentId);
                        }
                    }

                    if (signal.relevance_score >= 75 || (signal.relevance_score >= 60 && this.env.BETA_CHANNEL_ID)) {
                        await this.mirrorSignal(signal, signalId, "MARKET SIGNAL");
                    }
                }

                // Also update last_analyzed_at for all items in the batch to prevent re-processing
                for (const item of toAnalyze) {
                    this.storage.sql.exec('UPDATE content_items SET last_analyzed_at = ? WHERE id = ?', Date.now(), item.id);
                }
            }
            return toAnalyze.length > 0 || repurposed > 0;
        } catch (e) {
            console.error('[Orchestrator] Digest generation failed:', e);
            this.logger.logState("ORCHESTRATOR", "Digest failed", String(e));
            return false;
        }
    }

    /**
     * Routes commands to appropriate handlers.
     */
    async handleSlashCommand(text: string, chatId: string): Promise<string> {
        const parts = text.trim().split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);

        switch (command) {
            case '/status':
                const stats = this.store.getStats();
                const alive = "✅ Operational";
                return `📊 Status: ${stats.items} items, ${stats.signals} signals, ${stats.channels} channels\n📡 Bot API: ${alive}`;
            case '/ignore':
                if (args[0]) this.store.deleteChannel(args[0]);
                return `🔇 Channel ${args[0]} removed from watch list.`;
            case '/help':
                return `📖 Commands: /status, /ignore <id>, /help`;
            default:
                return "❓ Unknown command.";
        }
    }

    /**
     * Hardened reprocess for corrupted or missing data.
     */
    async reprocess(id: string, utils: any): Promise<boolean> {
        try {
            const item = this.store.getItem(id);
            if (!item) {
                this.logger.logState("REPROCESS", `Item not found: ${id}`);
                return false;
            }

            // If source_id is not a string, or is a string but not in "chatId:messageId" format,
            // we can't reliably re-fetch from Telegram.
            // For now, we'll assume source_id is a JSON string or a simple string.
            // If it's a JSON string, we need to parse it to get chatId and messageId.
            // If it's a simple string, we'll try to split it.
            let sourceChatId: string | undefined;
            let sourceMessageId: string | undefined;

            if (typeof item.source_id === 'string') {
                try {
                    const parsedSource = JSON.parse(item.source_id);
                    sourceChatId = parsedSource.chatId;
                    sourceMessageId = parsedSource.messageId;
                } catch (e) {
                    // Not a JSON string, try splitting
                    const parts = item.source_id.split(':');
                    if (parts.length === 2) {
                        sourceChatId = parts[0];
                        sourceMessageId = parts[1];
                    }
                }
            }

            if (!sourceChatId || !sourceMessageId) {
                this.logger.logState("REPROCESS", `Invalid or unparseable source_id for item: ${item.source_id}`, { id });
                // Mark as failed so we don't keep trying
                this.storage.sql.exec('UPDATE content_items SET is_signal = -1 WHERE id = ?', id);
                return false;
            }

            console.log(`[Orchestrator] Reprocessing item ${id} using stored text.`);

            // Trigger standard ingest logic but with existing ID and forceAnalysis
            // Note: Since MTProto is gone, we rely on stored raw_text for reprocessing.
            await this.processIngest({
                chatId: sourceChatId,
                messageId: sourceMessageId,
                title: item.source_name,
                text: item.raw_text,
            }, utils, { forceAnalysis: true, id });

            this.logger.logState("REPROCESS", `Successfully reprocessed ${id}`);
            return true;
        } catch (e: any) {
            this.logger.logState("REPROCESS", `Error during reprocess: ${e.message}`, e.stack);
            console.error(`[Orchestrator] Reprocess failed for ${id}:`, e);
            return false;
        }
    }

    /**
     * Mirrors a high-relevance signal to the Alpha Telegram Channel.
     */
    private async mirrorSignal(signal: any, signalId: string, title: string = "HIGH SIGNAL ALPHA"): Promise<void> {
        const DEFAULT_ALPHA = "-1003589267081";
        const targetChatId = this.env.ALPHA_CHANNEL_ID || DEFAULT_ALPHA;
        const betaChatId = this.env.BETA_CHANNEL_ID;

        const score = Number(signal.relevance_score || 0);

        // Determine target channel based on score (if Beta is configured)
        // If Beta is NOT configured, we only send High Signal (>=80) to Alpha (handled by caller currently, but let's be robust)
        let actualTargetId = targetChatId;
        let actualTitle = title;

        if (score < 80 && betaChatId) {
            actualTargetId = betaChatId;
            actualTitle = title.replace("HIGH SIGNAL ALPHA", "LOW SIGNAL BETA");
        }

        // If score is low and no beta channel, we might just skip mirroring? 
        // But the caller (processIngest) checks score >= 80 before calling this usually.
        // However, let's allow this method to handle routing logic if called with lower scores.

        const sentimentEmoji = signal.sentiment === 'bullish' ? '🟢' : signal.sentiment === 'bearish' ? '🔴' : '⚪️';
        const tickers = signal.tickers?.length ? `\n<b>Tickers:</b> ${signal.tickers.join(', ')}` : '';

        const msg = `🚀 <b>${actualTitle}</b>\n` +
            `————————————————————\n` +
            `<b>Summary:</b> ${signal.summary}\n\n` +
            `<b>Sentiment:</b> ${sentimentEmoji} ${signal.sentiment?.toUpperCase()}\n` +
            `<b>Relevance:</b> ${signal.relevance_score}%` +
            `${tickers}\n` +
            `————————————————————\n` +
            `<i>Actionable Intelligence extracted via Gemini 2.5 Flash</i>`;

        try {
            await this.telegram.sendMessage(actualTargetId, msg);
            console.log(`[Orchestrator] Signal ${signalId} mirrored to ${actualTargetId}`);
            this.logger.logState("ORCHESTRATOR", `Signal mirrored: ${signalId}`, { targetChatId: actualTargetId, title: actualTitle });
        } catch (e: any) {
            console.error(`[Orchestrator] Failed to mirror signal ${signalId}:`, e);
            this.logger.logState("ORCHESTRATOR_MIRROR_ERROR", `Mirror failed: ${e.message}`, {
                signalId,
                targetChatId: actualTargetId,
                error: e.stack
            });
        }
    }

    /**
     * Mirrors a high-conviction prediction to the Alpha Telegram Channel.
     */
    private async mirrorPrediction(pred: Prediction): Promise<void> {
        const DEFAULT_ALPHA = "-1003589267081";
        const targetChatId = this.env.ALPHA_CHANNEL_ID || DEFAULT_ALPHA;

        // Get entity label
        const entity = this.storage.sql.exec('SELECT label FROM graph_nodes WHERE id = ?', pred.entity_id).one() as any;
        const label = entity?.label || 'Unknown Asset';

        const typeEmoji = pred.prediction_type === 'bullish' ? '📈' : pred.prediction_type === 'bearish' ? '📉' : '⚖️';
        const sentimentEmoji = pred.prediction_type === 'bullish' ? '🟢' : pred.prediction_type === 'bearish' ? '🔴' : '⚪️';

        const msg = `🔮 <b>PREDICTIVE ALPHA GENERATED</b>\n` +
            `————————————————————\n` +
            `<b>Asset:</b> <code>${label}</code>\n` +
            `<b>Outlook:</b> ${typeEmoji} ${pred.prediction_type?.toUpperCase()}\n` +
            `<b>Conviction:</b> ${(pred.conviction_score * 100).toFixed(1)}%\n` +
            `<b>Sentiment:</b> ${sentimentEmoji}\n` +
            `————————————————————\n` +
            `<i>Model Confidence Threshold Exceeded.</i>`;

        try {
            await this.telegram.sendMessage(targetChatId, msg);
            console.log(`[Orchestrator] Prediction for ${label} mirrored to ${targetChatId}`);
        } catch (e) {
            console.error(`[Orchestrator] Failed to mirror prediction:`, e);
        }
    }

    /**
     * Handles interactive callback buttons from Telegram signals.
     */
    private async handleCallback(text: string, chatId: string): Promise<string | null> {
        const parts = text.split(':');
        const type = parts[1];
        const id = parts[2];

        const item = this.store.getItem(id);
        if (!item) {
            await this.telegram.sendMessage(chatId, '❌ Signal not found or expired.');
            return null;
        }

        let prompt = "";
        let prefix = "";

        if (type === 'chk') {
            prompt = `Role: Forensic Fact-Checker. Analyze the following content for truthfulness, source reliability, and logical fallacies. Output a forensic evidence map.\nContent: ${item.raw_text}`;
            prefix = "Running <b>🔎 FACT CHECK...</b>";
        } else if (type === 'syn') {
            prompt = `Role: Senior Portfolio Manager. Synthesize the following content into a high-conviction investment thesis.\nContent: ${item.raw_text}`;
            prefix = "Running <b>⚡ SYNTHESIS...</b>";
        } else if (type === 'div') {
            prompt = `Role: Epistemic Analyst. Perform a deep dive into the limits of knowledge regarding the following content. What is known vs speculated?\nContent: ${item.raw_text}`;
            prefix = "Running <b>🧠 DEEP DIVE...</b>";
        } else {
            return "unknown_callback";
        }

        await this.telegram.sendMessage(chatId, prefix);

        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.env.GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ role: 'user', parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.2 }
                    })
                }
            );

            if (!response.ok) throw new Error("AI Service Unavailable");

            const result = await response.json() as any;
            const output = result.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";

            await this.telegram.sendMessage(chatId, `✅ <b>Analysis Complete</b>\n\n${output}`);
            return "callback_processed";
        } catch (e: any) {
            console.error("[Orchestrator] Callback AI execution failed:", e);
            this.logger.logState("ORCHESTRATOR_CALLBACK_ERROR", `AI execution failed: ${e.message}`, {
                chatId,
                type,
                error: e.stack
            });
            await this.telegram.sendMessage(chatId, "❌ AI analysis failed. Please try again later.");
            return "callback_error";
        }
    }
}
