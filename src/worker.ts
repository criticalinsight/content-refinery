import { Env } from './types';
export { ContentDO } from './ContentDO';

// CORS headers for cross-origin requests
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function addCorsHeaders(response: Response): Response {
    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
        newHeaders.set(key, value);
    });
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
    });
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

        // Handle CORS preflight requests
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: corsHeaders
            });
        }

        // Simple health check
        if (url.pathname === '/' || url.pathname === '/health') {
            return new Response('Content Refinery Active [v1.7.5]', {
                status: 200,
                headers: corsHeaders
            });
        }

        // Telegram Webhook (Phase 4)
        if (url.pathname === '/telegram-webhook') {
            const id = env.CONTENT_DO.idFromName('default');
            const stub = env.CONTENT_DO.get(id);
            return stub.fetch(request);
        }

        // Forward refinery routes to ContentDO
        const id = env.CONTENT_DO.idFromName('default');
        const stub = env.CONTENT_DO.get(id);

        // Check for WebSocket upgrade
        if (request.headers.get('Upgrade') === 'websocket') {
            return stub.fetch(request);
        }

        // Proxy the request to the Durable Object and add CORS headers
        const response = await stub.fetch(request);
        return addCorsHeaders(response);
    }
};
