import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

export class TelegramManager {
    private client: TelegramClient | null = null;
    private session: StringSession;

    constructor(private env: any, sessionStr: string = "") {
        this.session = new StringSession(sessionStr);
    }

    async init() {
        if (this.client) return;

        const apiId = parseInt(this.env.TELEGRAM_API_ID);
        const apiHash = this.env.TELEGRAM_API_HASH;

        if (!apiId || !apiHash) {
            throw new Error("TELEGRAM_API_ID and TELEGRAM_API_HASH must be configured.");
        }

        this.client = new TelegramClient(this.session, apiId, apiHash, {
            connectionRetries: 5,
        });
    }

    async connect(botToken?: string) {
        await this.init();
        if (!this.client) return;

        if (botToken) {
            await this.client.start({
                botAuthToken: botToken,
            });
        } else {
            // For user login, this would typically involve a code flow handled elsewhere
            await this.client.connect();
        }

        return this.client.session.save();
    }

    getClient() {
        return this.client;
    }

    async listen(onMessage: (msg: any) => Promise<void>) {
        if (!this.client) await this.connect(this.env.TELEGRAM_BOT_TOKEN);

        this.client?.addEventHandler(async (event: any) => {
            const message = event.message;
            if (message && message.message) {
                await onMessage({
                    chatId: message.peerId?.toString(),
                    title: "Telegram Live", // Peer details can be fetched for better naming
                    text: message.message
                });
            }
        });
    }
}
