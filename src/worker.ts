import { Env } from './types';
export { ContentDO } from './ContentDO';

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

        // Simple health check
        if (url.pathname === '/') {
            return new Response('Content Refinery Active', { status: 200 });
        }

        // Forward refinery routes to ContentDO
        const id = env.CONTENT_DO.idFromName('default');
        const stub = env.CONTENT_DO.get(id);

        // Check for WebSocket upgrade
        if (request.headers.get('Upgrade') === 'websocket') {
            return stub.fetch(request);
        }

        // Proxy the request to the Durable Object
        return stub.fetch(request);
    },
};
