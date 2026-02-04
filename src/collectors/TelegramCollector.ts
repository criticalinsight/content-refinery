import { Env } from '../types';
import { FactStore } from '../FactStore';
import { ErrorLogger } from '../ErrorLogger';

/**
 * TelegramCollector handles the Telegram Bot API bridge.
 * Simplified to use direct fetch calls for the Alpha Pipe.
 */
export class TelegramCollector {
    constructor(
        private env: Env,
        private storage: DurableObjectStorage,
        private store: FactStore,
        private logger: ErrorLogger
    ) {
        this.logger.setNotifyCallback(async (module, message) => {
            if (!this.env.TELEGRAM_BOT_TOKEN || !this.env.ADMIN_CHANNEL_ID) return;
            const alertMsg = `🚨 <b>SYSTEM ALERT</b>\n<b>Module:</b> ${module}\n<b>Error:</b> ${message}`;
            await this.sendMessage(this.env.ADMIN_CHANNEL_ID, alertMsg);
        });
    }

    async handleUpdate(update: any, onMessage: (msg: any) => Promise<void>) {
        const message = update.message || update.channel_post;
        if (!message || !message.text) return;

        await onMessage({
            chatId: message.chat.id.toString(),
            messageId: message.message_id.toString(),
            text: message.text,
            title: message.chat.title || message.from?.username || 'Telegram'
        });
    }

    async sendMessage(chatId: string, text: string, buttons?: any[]) {
        const token = this.env.TELEGRAM_BOT_TOKEN;
        if (!token) return;

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'HTML',
                reply_markup: buttons ? { inline_keyboard: buttons } : undefined
            })
        });
    }

}
