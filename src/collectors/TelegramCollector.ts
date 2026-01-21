import { TelegramManager } from '../telegram';
import { Env } from '../types';
import { FactStore } from '../FactStore';
import { ErrorLogger } from '../ErrorLogger';

/**
 * TelegramCollector unentangles the MTProto lifecycle from the core DO.
 * It handles connection, authentication, and message listening.
 */
export class TelegramCollector {
    private telegram: TelegramManager | null = null;

    constructor(
        private env: Env,
        private storage: DurableObjectStorage,
        private store: FactStore,
        private logger: ErrorLogger
    ) { }

    async ensureConnection(): Promise<TelegramManager> {
        if (this.telegram && this.telegram.getClient()?.connected) {
            if (await this.telegram.isLoggedIn()) return this.telegram;
        }

        const sessionStr = await this.storage.get<string>('tg_session') || "";
        this.telegram = new TelegramManager(this.env, this.storage, sessionStr, async (newSession) => {
            if (newSession) {
                await this.storage.put('tg_session', newSession);
            }
        });

        await this.telegram.connect();
        return this.telegram;
    }

    async setupListener(onMessage: (msg: any) => Promise<void>) {
        const tg = await this.ensureConnection();
        if (await tg.isLoggedIn()) {
            tg.listen(onMessage);

            this.logger.setNotifyCallback(async (module, message) => {
                const ADMIN_ID = "-1003589267081";
                const alertMsg = `🚨 <b>SYSTEM ALERT</b>\n<b>Module:</b> ${module}\n<b>Error:</b> ${message}`;
                await this.telegram?.sendMessage(ADMIN_ID, alertMsg);
            });
        }
    }

    async sendMessage(chatId: string, text: string, buttons?: any) {
        const tg = await this.ensureConnection();
        await tg.sendMessage(chatId, text, buttons);
    }

    getClient() {
        return this.telegram?.getClient();
    }

    async resetSession() {
        if (this.telegram) {
            try { await this.telegram.getClient()?.disconnect(); } catch (e) { }
            this.telegram = null; // Next ensureConnection will recreate with empty session if storage cleared
        }
    }
}
