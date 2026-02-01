import { FactStore } from '../FactStore';
import { Env } from '../types';

export class KnowledgeService {
    constructor(private store: FactStore, private env: Env, private storage: DurableObjectStorage) { }

    async dispatch(request: Request, url: URL, utils: {
        getCache: (t: 'signal' | 'narrative') => any,
        setCache: (t: 'signal' | 'narrative', d: any) => void
    }): Promise<Response> {
        if (url.pathname === '/knowledge/graph') {
            const nodes = this.storage.sql.exec('SELECT * FROM graph_nodes').toArray();
            const links = this.storage.sql.exec('SELECT * FROM graph_edges').toArray();
            return Response.json({ nodes, links });
        }

        if (url.pathname === '/knowledge/sync') {
            const items = this.storage.sql.exec('SELECT id, processed_json FROM content_items WHERE processed_json IS NOT NULL AND synced_to_graph = 0 LIMIT 50').toArray();
            return Response.json({ items });
        }

        if (url.pathname === '/knowledge/alpha' || url.pathname === '/alpha') {
            const alphaNodes = this.storage.sql.exec(`
                SELECT id, label, importance, sentiment_score, velocity,
                (importance * 0.5 + sentiment_score * 2.0 + velocity * 1.5) as alpha_score
                FROM graph_nodes 
                WHERE type = 'entity'
                ORDER BY alpha_score DESC 
                LIMIT 10
            `).toArray() as any[];
            return Response.json({ alphaNodes });
        }

        if (url.pathname === '/knowledge/narratives' || url.pathname === '/narratives') {
            const cached = utils.getCache('narrative');
            if (cached) return Response.json(cached);

            const narratives = this.storage.sql.exec(`
                SELECT * FROM narratives 
                ORDER BY created_at DESC 
                LIMIT 5
            `).toArray() as any[];

            const responseData = {
                narratives: narratives.map((n: any) => ({
                    ...n,
                    signals: n.signals ? JSON.parse(n.signals) : []
                }))
            };

            utils.setCache('narrative', responseData);
            return Response.json(responseData);
        }

        return new Response('Knowledge endpoint not found', { status: 404 });
    }
}
