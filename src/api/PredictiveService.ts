import { PredictiveEngine } from '../logic/PredictiveEngine';

/**
 * PredictiveService - API endpoints for Phase 18: Predictive Alpha
 */
export class PredictiveService {
    private engine: PredictiveEngine;

    constructor(private storage: DurableObjectStorage) {
        this.engine = new PredictiveEngine(storage);
    }

    async dispatch(request: Request, url: URL): Promise<Response> {
        // GET /predictive/metrics - Get top entities by conviction score
        if (url.pathname === '/predictive/metrics' || url.pathname === '/metrics') {
            const limit = parseInt(url.searchParams.get('limit') || '20');
            const metrics = this.engine.calculateConvictionScores().slice(0, limit);
            
            return Response.json({
                metrics,
                timestamp: Date.now(),
                count: metrics.length
            });
        }

        // GET /predictive/predictions - Get all predictions with optional filters
        if (url.pathname === '/predictive/predictions' || url.pathname === '/predictions') {
            const status = url.searchParams.get('status'); // pending, correct, incorrect
            const entityId = url.searchParams.get('entity_id');
            
            let query = 'SELECT * FROM predictions';
            const params: any[] = [];
            const conditions: string[] = [];
            
            if (status) {
                conditions.push('outcome = ?');
                params.push(status);
            }
            
            if (entityId) {
                conditions.push('entity_id = ?');
                params.push(entityId);
            }
            
            if (conditions.length > 0) {
                query += ' WHERE ' + conditions.join(' AND ');
            }
            
            query += ' ORDER BY predicted_at DESC LIMIT 50';
            
            const predictions = this.storage.sql.exec(query, ...params).toArray();
            
            return Response.json({
                predictions,
                count: predictions.length
            });
        }

        // GET /predictive/backtest - Get backtesting accuracy results
        if (url.pathname === '/predictive/backtest' || url.pathname === '/backtest') {
            const results = this.engine.getBacktestResults();
            
            return Response.json({
                ...results,
                accuracy_percent: (results.accuracy * 100).toFixed(2) + '%',
                timestamp: Date.now()
            });
        }

        // GET /predictive/sentiment/:entityId - Get sentiment history for an entity
        if (url.pathname.startsWith('/predictive/sentiment/')) {
            const entityId = url.pathname.split('/').pop();
            const daysBack = parseInt(url.searchParams.get('days') || '30');
            
            if (!entityId) {
                return Response.json({ error: 'Entity ID required' }, { status: 400 });
            }
            
            const history = this.engine.getSentimentHistory(entityId, daysBack);
            
            return Response.json({
                entity_id: entityId,
                history,
                count: history.length,
                days: daysBack
            });
        }

        // GET /predictive/centrality - Get centrality scores for all nodes
        if (url.pathname === '/predictive/centrality') {
            const centralityMap = this.engine.calculateCentrality();
            const centrality = Array.from(centralityMap.entries()).map(([id, score]) => ({
                id,
                score
            })).sort((a, b) => b.score - a.score).slice(0, 50);
            
            return Response.json({
                centrality,
                count: centrality.length,
                timestamp: Date.now()
            });
        }

        // POST /predictive/record-sentiment - Manually record sentiment (for testing/backfill)
        if (url.pathname === '/predictive/record-sentiment' && request.method === 'POST') {
            const body = await request.json() as any;
            const { entity_id, sentiment, signal_id, relevance_score } = body;
            
            if (!entity_id || sentiment === undefined || !signal_id) {
                return Response.json({ 
                    error: 'Missing required fields: entity_id, sentiment, signal_id' 
                }, { status: 400 });
            }
            
            this.engine.recordSentiment(
                entity_id,
                sentiment,
                signal_id,
                relevance_score || 1.0
            );
            
            return Response.json({
                success: true,
                message: 'Sentiment recorded'
            });
        }

        // POST /predictive/update - Manually trigger prediction update cycle
        if (url.pathname === '/predictive/update' && request.method === 'POST') {
            await this.engine.tick();
            
            return Response.json({
                success: true,
                message: 'Predictive analysis cycle completed',
                timestamp: Date.now()
            });
        }

        // POST /predictive/verify-prediction - Mark a prediction as correct/incorrect
        if (url.pathname === '/predictive/verify-prediction' && request.method === 'POST') {
            const body = await request.json() as any;
            const { prediction_id, outcome } = body;
            
            if (!prediction_id || !outcome || !['correct', 'incorrect'].includes(outcome)) {
                return Response.json({
                    error: 'Invalid request. Required: prediction_id, outcome (correct/incorrect)'
                }, { status: 400 });
            }
            
            this.storage.sql.exec(
                'UPDATE predictions SET outcome = ?, verified_at = ? WHERE id = ?',
                outcome,
                Date.now(),
                prediction_id
            );
            
            return Response.json({
                success: true,
                message: `Prediction marked as ${outcome}`,
                prediction_id
            });
        }

        // GET /predictive/top-movers - Entities with highest velocity (momentum)
        if (url.pathname === '/predictive/top-movers') {
            const metrics = this.engine.calculateConvictionScores();
            const topMovers = metrics
                .filter(m => Math.abs(m.velocity) > 0.1)
                .sort((a, b) => Math.abs(b.velocity) - Math.abs(a.velocity))
                .slice(0, 10);
            
            return Response.json({
                top_movers: topMovers,
                count: topMovers.length,
                timestamp: Date.now()
            });
        }

        return new Response('Predictive endpoint not found', { status: 404 });
    }

    /**
     * Get the engine instance for use by other services
     */
    getEngine(): PredictiveEngine {
        return this.engine;
    }
}
