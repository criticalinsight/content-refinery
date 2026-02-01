import { FactStore } from '../FactStore';
import { Env } from '../types';
import { SignalService } from './SignalService';
import { AdminService } from './AdminService';
import { KnowledgeService } from './KnowledgeService';
import { PredictiveService } from './PredictiveService';

export class Router {
    private signals: SignalService;
    private admin: AdminService;
    private knowledge: KnowledgeService;
    private predictive: PredictiveService;

    constructor(private store: FactStore, private env: Env, private storage: DurableObjectStorage, private orchestrator: any) {
        this.signals = new SignalService(store, env, storage);
        this.admin = new AdminService(store, env, storage, orchestrator);
        this.knowledge = new KnowledgeService(store, env, storage);
        this.predictive = new PredictiveService(storage);
    }

    async handle(request: Request, ctx: {
        getCache: (t: 'signal' | 'narrative') => any,
        setCache: (t: 'signal' | 'narrative', d: any) => void,
        generateEmbeddings: (t: string) => Promise<number[] | null>
    }): Promise<Response> {
        const url = new URL(request.url);

        // Dispatch to optimized handlers
        if (url.pathname.startsWith('/admin')) {
            return this.admin.dispatch(request, url);
        }

        if (url.pathname === '/health' || url.pathname === '/stats') {
            return this.admin.dispatch(request, url);
        }

        if (url.pathname.startsWith('/signals') || url.pathname.startsWith('/search')) {
            return this.signals.handleSearch(url, { generateEmbeddings: ctx.generateEmbeddings });
        }

        if (url.pathname.startsWith('/graph') || url.pathname.startsWith('/knowledge') || url.pathname.startsWith('/alpha') || url.pathname.startsWith('/narratives')) {
            return this.knowledge.dispatch(request, url, {
                getCache: ctx.getCache,
                setCache: ctx.setCache
            });
        }

        if (url.pathname.startsWith('/predictive') || url.pathname.startsWith('/metrics') || url.pathname.startsWith('/predictions') || url.pathname.startsWith('/backtest')) {
            return this.predictive.dispatch(request, url);
        }

        // Return 404 for unhandled paths (to be delegated back to DO for now)
        return new Response('Not Found', { status: 404 });
    }
}
