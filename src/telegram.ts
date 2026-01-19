import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";

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

    async init() {
        if (this.client) return;

        const apiId = parseInt(this.env.TELEGRAM_API_ID);
        const apiHash = this.env.TELEGRAM_API_HASH;

        if (!apiId || !apiHash) {
            throw new Error("TELEGRAM_API_ID and TELEGRAM_API_HASH must be configured.");
        }

        this.client = new TelegramClient(this.session, apiId, apiHash, {
            connectionRetries: 5,
            deviceModel: "ContentRefinery v1.5",
            systemVersion: "Linux",
            appVersion: "1.0.0"
        });
    }

    async connect() {
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

    // Step 1: Send verification code to phone
    async sendCode(phoneNumber: string): Promise<string> {
        await this.connect();
        const result = await this.client!.sendCode(
            {
                apiId: parseInt(this.env.TELEGRAM_API_ID),
                apiHash: this.env.TELEGRAM_API_HASH,
            },
            phoneNumber
        );
        this.phoneCodeHash = result.phoneCodeHash;
        return result.phoneCodeHash;
    }

    // Step 2: Sign in with the received code
    async signIn(phoneNumber: string, phoneCodeHash: string, code: string): Promise<string> {
        await this.connect();
        try {
            await this.client!.invoke(
                new Api.auth.SignIn({
                    phoneNumber,
                    phoneCodeHash,
                    phoneCode: code,
                })
            );
            const session = this.client!.session.save() as unknown as string;
            await this.triggerSessionUpdate(session);
            return session;
        } catch (e: any) {
            if (e.errorMessage === "SESSION_PASSWORD_NEEDED") {
                throw new Error("2FA_REQUIRED");
            }
            throw e;
        }
    }

    // Step 2b: Complete 2FA with password
    async checkPassword(password: string): Promise<string> {
        await this.connect();
        // Use signInWithPassword which handles SRP internally
        const result = await this.client!.invoke(new Api.account.GetPassword());
        const passwordCheck = await this.client!.invoke(
            new Api.auth.CheckPassword({
                password: await this.computeSrp(result, password)
            })
        );
        const session = this.client!.session.save() as unknown as string;
        await this.triggerSessionUpdate(session);
        return session;
    }

    private async computeSrp(passwordResult: Api.account.Password, password: string): Promise<Api.InputCheckPasswordSRP> {
        // Gram.js provides a helper for this
        const { computeCheck } = await import("telegram/Password");
        return computeCheck(passwordResult, password);
    }

    async isLoggedIn() {
        if (!this.client || !this.client.connected) return false;
        try {
            const me = await this.client.getMe();
            return !!me;
        } catch (e) {
            return false;
        }
    }

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

    getClient() {
        return this.client;
    }

    getPhoneCodeHash() {
        return this.phoneCodeHash;
    }

    // QR Login: Generate login token and return URL for QR code
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
            // Convert Uint8Array to base64url without Buffer
            const tokenBytes = result.token;
            const tokenBase64 = btoa(String.fromCharCode(...tokenBytes))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=/g, '');
            const url = `tg://login?token=${tokenBase64}`;
            return {
                token: tokenBase64,
                url,
                expires: result.expires
            };
        }

        throw new Error('Failed to generate QR login token');
    }

    // QR Login: Check if user has scanned QR and approved login
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
                // User approved! We're logged in
                const session = this.client!.session.save() as unknown as string;
                await this.triggerSessionUpdate(session);
                return {
                    success: true,
                    session
                };
            } else if (result instanceof Api.auth.LoginTokenMigrateTo) {
                // Need to migrate to another DC - handle this case
                throw new Error('DC migration required - not supported yet');
            } else if (result instanceof Api.auth.LoginToken) {
                // Still waiting for user to scan
                return { success: false };
            }

            return { success: false };
        } catch (e: any) {
            if (e.errorMessage === 'SESSION_PASSWORD_NEEDED') {
                return { success: false, needsPassword: true };
            }
            throw e;
        }
    }
}
