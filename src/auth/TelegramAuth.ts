import { Env } from '../types';
import { TelegramCollector } from '../collectors/TelegramCollector';

export class TelegramAuthManager {
    constructor(
        private storage: DurableObjectStorage,
        private env: Env,
        private telegram: TelegramCollector // We'll need to define this type or import it
    ) { }

    async handleRequest(request: Request, url: URL): Promise<Response | null> {
        if (url.pathname === '/telegram/auth/logout' && request.method === 'POST') {
            await this.storage.delete('tg_session');
            await this.telegram.resetSession();
            return Response.json({ success: true, message: 'Telegram session cleared. Re-auth via QR required.' });
        }

        if (url.pathname === '/telegram/auth/restore' && request.method === 'POST') {
            const { session } = await request.json() as any;
            if (!session) return Response.json({ success: false, error: 'Missing session string' }, { status: 400 });
            await this.storage.put('tg_session', session);
            const tg = await this.telegram.ensureConnection();
            const loggedIn = await tg.isLoggedIn();
            return Response.json({ success: true, status: loggedIn ? 'online' : 'offline', message: 'Session string restored.' });
        }

        if (url.pathname === '/telegram/auth/status' && request.method === 'GET') {
            if (!this.env.TELEGRAM_API_ID || !this.env.TELEGRAM_API_HASH) {
                return Response.json({ status: 'unconfigured', error: 'TELEGRAM_API_ID and TELEGRAM_API_HASH must be set as secrets.' }, { status: 500 });
            }
            try {
                const tg = await this.telegram.ensureConnection();
                const loggedIn = await tg.isLoggedIn();
                return Response.json({ status: loggedIn ? 'online' : 'offline' });
            } catch (e) {
                return Response.json({ status: 'error', error: e instanceof Error ? e.message : String(e) }, { status: 400 });
            }
        }

        if (url.pathname === '/telegram/auth/send-code' && request.method === 'POST') {
            const { phone } = await request.json() as any;
            const tg = await this.telegram.ensureConnection();
            try {
                const phoneCodeHash = await tg.sendCode(phone);
                await this.storage.put('tg_phone', phone);
                await this.storage.put('tg_phone_code_hash', phoneCodeHash);
                return Response.json({ success: true, message: 'Code sent to your Telegram app' });
            } catch (e) {
                return Response.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
            }
        }

        if (url.pathname === '/telegram/auth/sign-in' && request.method === 'POST') {
            const { code, password } = await request.json() as any;
            const phone = await this.storage.get<string>('tg_phone');
            const phoneCodeHash = await this.storage.get<string>('tg_phone_code_hash');

            if (!phone || !phoneCodeHash) return Response.json({ success: false, error: 'No pending sign-in. Call send-code first.' }, { status: 400 });

            const tg = await this.telegram.ensureConnection();
            try {
                let newSession = password ? await tg.checkPassword(password) : await tg.signIn(phone, phoneCodeHash, code);
                await this.storage.put('tg_session', newSession);
                // Note: The listener setup should probably be handled by the caller or a central event bus
                return Response.json({ success: true });
            } catch (e: any) {
                if (e.message === '2FA_REQUIRED') return Response.json({ success: false, requires2FA: true, error: '2FA required' });
                return Response.json({ success: false, error: e.message }, { status: 500 });
            }
        }

        if (url.pathname === '/telegram/auth/me' && request.method === 'GET') {
            try {
                const tg = await this.telegram.ensureConnection();
                const client = tg.getClient();
                if (!client || !await tg.isLoggedIn()) return Response.json({ loggedIn: false });
                const me = await client.getMe();
                return Response.json({
                    loggedIn: true,
                    user: { id: me.id?.toString(), firstName: me.firstName, lastName: me.lastName, username: me.username }
                });
            } catch (e) {
                return Response.json({ loggedIn: false, error: String(e) });
            }
        }

        if (url.pathname === '/telegram/auth/qr-token') {
            const tg = await this.telegram.ensureConnection();
            try {
                const tokenData = await tg.getQrLoginToken();
                return Response.json({ success: true, ...tokenData });
            } catch (e) {
                return Response.json({ success: false, error: String(e) }, { status: 500 });
            }
        }

        if (url.pathname === '/telegram/auth/qr-check') {
            const tg = await this.telegram.ensureConnection();
            try {
                const result = await tg.checkQrLogin();
                if (result.success && result.session) {
                    await this.storage.put('tg_session', result.session);
                    return Response.json({ success: true, loggedIn: true });
                }
                return Response.json({ success: true, loggedIn: false, needsPassword: result.needsPassword });
            } catch (e) {
                return Response.json({ success: false, error: String(e) }, { status: 500 });
            }
        }

        if (url.pathname === '/telegram/auth/qr-password') {
            const { password } = await request.json() as any;
            if (!password) return Response.json({ success: false, error: 'Password required' }, { status: 400 });
            const tg = await this.telegram.ensureConnection();
            try {
                const newSession = await tg.checkPassword(password);
                await this.storage.put('tg_session', newSession);
                return Response.json({ success: true });
            } catch (e) {
                return Response.json({ success: false, error: String(e) }, { status: 500 });
            }
        }

        return null;
    }
}
