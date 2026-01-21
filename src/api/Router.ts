import { FactStore } from '../FactStore';
import { Env } from '../types';

/**
 * Router handles the unentanglement of API concerns from the core DO.
 * It is stateless and acts as a dispatcher for incoming HTTP requests.
 */
export class Router {
    constructor(private store: FactStore, private env: Env) { }

    async handle(request: Request): Promise<Response> {
        const url = new URL(request.url);

        // Dispatch to optimized handlers
        if (url.pathname === '/health' || url.pathname === '/stats') {
            return this.handleHealth();
        }

        if (url.pathname.startsWith('/signals')) {
            return this.handleSignals(url);
        }

        if (url.pathname.startsWith('/analytics')) {
            return this.handleAnalytics(url);
        }

        // Return 404 for unhandled paths (to be delegated back to DO for now)
        return new Response('Not Found', { status: 404 });
    }

    private handleHealth(): Response {
        return Response.json({ status: 'online', engine: 'Refinery v2.0' });
    }

    private handleSignals(url: URL): Response {
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const offset = parseInt(url.searchParams.get('offset') || '0');

        const signals = this.store.listSignals(limit, offset);
        return Response.json({ success: true, signals });
    }

    private handleAnalytics(url: URL): Response {
        // Daily signal volume (last 30 days) placeholder
        return Response.json({ success: true, message: "Analytics handled by Router" });
    }
}
