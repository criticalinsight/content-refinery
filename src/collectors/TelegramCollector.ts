import { TelegramBotCollector } from '../logic/TelegramBotCollector';
import { Env } from '../types';
import { FactStore } from '../FactStore';
import { ErrorLogger } from '../ErrorLogger';

/**
 * TelegramCollector handles the Telegram Bot API bridge.
 * Transitioned from MTProto (GramJS) to Bot API for reliability and efficiency.
 */
export class TelegramCollector {
    constructor(
        private env: Env,
        private storage: DurableObjectStorage,
        private store: FactStore,
        private logger: ErrorLogger
    ) {
        // Initialize notify callback to use Bot API
        this.logger.setNotifyCallback(async (module, message) => {
            if (!this.env.TELEGRAM_BOT_TOKEN || !this.env.ADMIN_CHANNEL_ID) return;
            const alertMsg = `🚨 <b>SYSTEM ALERT</b>\n<b>Module:</b> ${module}\n<b>Error:</b> ${message}`;
            await this.sendMessage(this.env.ADMIN_CHANNEL_ID, alertMsg);
        });
    }

    async handleUpdate(update: any, onMessage: (msg: any) => Promise<void>) {
        const ingestRequest = TelegramBotCollector.parseUpdate(update);
        if (ingestRequest) {
            await onMessage(ingestRequest);
        }
    }

    async sendMessage(chatId: string, text: string, buttons?: any[]) {
        if (!this.env.TELEGRAM_BOT_TOKEN) {
            console.error('[TelegramCollector] TELEGRAM_BOT_TOKEN missing');
            return;
        }
        await TelegramBotCollector.sendMessage(this.env.TELEGRAM_BOT_TOKEN, chatId, text, buttons);
    }

    async downloadMedia(fileId: string): Promise<Uint8Array | null> {
        if (!this.env.TELEGRAM_BOT_TOKEN) return null;
        return await TelegramBotCollector.downloadFile(this.env.TELEGRAM_BOT_TOKEN, fileId);
    }
}
