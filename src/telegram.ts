import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";

/**
 * TelegramManager handles the MTProto lifecycle, including authentication,
 * session persistence, and real-time message listening.
 * 
 * Time Complexity (Auth): O(1) relative to number of users, but bounded by network.
 * Space Complexity: O(1) (Session string storage).
 */
export class TelegramManager {
    private client: TelegramClient | null = null;
    private session: StringSession;
    private phoneCodeHash: string = "";
    private isListening: boolean = false;
    private onSessionUpdate?: (session: string) => Promise<void>;

    constructor(private env: any, sessionStr: string = "", onSessionUpdate?: (session: string) => Promise<void>) {
        this.session = new StringSession(sessionStr);
        this.onSessionUpdate = onSessionUpdate;
    }

    /**
     * Initializes the client with secrets from Env.
     */
    async init() {
        if (this.client) return;

        const apiId = parseInt(this.env.TELEGRAM_API_ID);
        const apiHash = this.env.TELEGRAM_API_HASH;

        if (!apiId || !apiHash) {
            throw new Error("TELEGRAM_API_ID and TELEGRAM_API_HASH must be configured.");
        }

        this.client = new TelegramClient(this.session, apiId, apiHash, {
            connectionRetries: 5,
            deviceModel: "ContentRefinery v1.7",
            systemVersion: "Linux",
            appVersion: "1.0.0"
        });
    }

    /**
     * Establishes a connection and triggers session updates.
     */
    async connect(): Promise<string | undefined> {
        await this.init();
        if (!this.client) return;
        if (!this.client.connected) {
            await this.client.connect();
        }
        const session = this.client.session.save() as unknown as string;
        await this.triggerSessionUpdate(session);
        return session;
    }

    private async triggerSessionUpdate(session: string) {
        if (this.onSessionUpdate) {
            await this.onSessionUpdate(session);
        }
    }

    /**
     * Step 1: Send verification code to phone.
     * @param phoneNumber - International format E.164
     */
    async sendCode(phoneNumber: string): Promise<string> {
        await this.connect();
        const result = await this.client!.sendCode(
            { apiId: parseInt(this.env.TELEGRAM_API_ID), apiHash: this.env.TELEGRAM_API_HASH },
            phoneNumber
        );
        this.phoneCodeHash = result.phoneCodeHash;
        return result.phoneCodeHash;
    }

    /**
     * Step 2: Sign in with code.
     */
    async signIn(phoneNumber: string, phoneCodeHash: string, code: string): Promise<string> {
        await this.connect();
        try {
            await this.client!.invoke(
                new Api.auth.SignIn({ phoneNumber, phoneCodeHash, phoneCode: code })
            );
            const session = this.client!.session.save() as unknown as string;
            await this.triggerSessionUpdate(session);
            return session;
        } catch (e: any) {
            if (e.errorMessage === "SESSION_PASSWORD_NEEDED") throw new Error("2FA_REQUIRED");
            throw e;
        }
    }

    /**
     * Provides 2FA password to complete sign-in.
     */
    async checkPassword(password: string): Promise<string> {
        await this.connect();
        const result = await this.client!.invoke(new Api.account.GetPassword());
        await this.client!.invoke(
            new Api.auth.CheckPassword({ password: await this.computeSrp(result, password) })
        );
        const session = this.client!.session.save() as unknown as string;
        await this.triggerSessionUpdate(session);
        return session;
    }

    private async computeSrp(passwordResult: Api.account.Password, password: string): Promise<Api.InputCheckPasswordSRP> {
        const { computeCheck } = await import("telegram/Password");
        return computeCheck(passwordResult, password);
    }

    /**
     * Checks if the client is currently logged in.
     */
    async isLoggedIn(): Promise<boolean> {
        if (!this.client || !this.client.connected) return false;
        try {
            const me = await this.client.getMe();
            return !!me;
        } catch (e) {
            return false;
        }
    }

    /**
     * Subscribes to new messages and passes them to the onMessage callback.
     * Guarded to prevent duplicate handlers.
     */
    async listen(onMessage: (msg: any) => Promise<void>) {
        if (this.isListening) return;
        await this.connect();

        this.client?.addEventHandler(async (event: any) => {
            const message = event.message;
            if (message && message.message) {
                await onMessage({
                    chatId: message.peerId?.toString(),
                    title: "Telegram Live",
                    text: message.message
                });
            }
        }, new NewMessage({}));
        this.isListening = true;
    }

    /**
     * Returns the raw Gram.js client.
     */
    getClient(): TelegramClient | null {
        return this.client;
    }

    /**
     * QR Login: Generate login token for browser-less authentication.
     */
    async getQrLoginToken(): Promise<{ token: string; url: string; expires: number }> {
        await this.connect();
        const result = await this.client!.invoke(
            new Api.auth.ExportLoginToken({
                apiId: parseInt(this.env.TELEGRAM_API_ID),
                apiHash: this.env.TELEGRAM_API_HASH,
                exceptIds: []
            })
        );

        if (result instanceof Api.auth.LoginToken) {
            const tokenBytes = result.token;
            const tokenBase64 = btoa(String.fromCharCode(...tokenBytes))
                .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
            return { token: tokenBase64, url: `tg://login?token=${tokenBase64}`, expires: result.expires };
        }
        throw new Error('Failed to generate QR login token');
    }

    /**
     * Checks the status of a pending QR login.
     */
    async checkQrLogin(): Promise<{ success: boolean; session?: string; needsPassword?: boolean }> {
        await this.connect();
        try {
            const result = await this.client!.invoke(
                new Api.auth.ExportLoginToken({
                    apiId: parseInt(this.env.TELEGRAM_API_ID),
                    apiHash: this.env.TELEGRAM_API_HASH,
                    exceptIds: []
                })
            );

            if (result instanceof Api.auth.LoginTokenSuccess) {
                const session = this.client!.session.save() as unknown as string;
                await this.triggerSessionUpdate(session);
                return { success: true, session };
            }
            return { success: false, needsPassword: result instanceof Api.auth.LoginTokenMigrateTo };
        } catch (e: any) {
            if (e.errorMessage === 'SESSION_PASSWORD_NEEDED') return { success: false, needsPassword: true };
            throw e;
        }
    }
}
