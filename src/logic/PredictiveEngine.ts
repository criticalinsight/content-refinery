/**
 * PredictiveEngine - Phase 18: Predictive Alpha
 * Implements centrality scoring, sentiment aggregation, and conviction signals.
 */

export interface EntityMetrics {
    id: string;
    label: string;
    type: string;
    centrality: number;
    sentiment_score: number;
    velocity: number;
    conviction_score: number;
    signal_count: number;
    last_updated: number;
}

export interface SentimentSnapshot {
    entity_id: string;
    timestamp: number;
    sentiment: number;
    signal_id: string;
    relevance_score: number;
}

export interface Prediction {
    id: string;
    entity_id: string;
    prediction_type: 'bullish' | 'bearish' | 'neutral';
    conviction_score: number;
    predicted_at: number;
    outcome?: 'correct' | 'incorrect' | 'pending';
    verified_at?: number;
}

export class PredictiveEngine {
    constructor(private storage: DurableObjectStorage) { }

    /**
     * Calculate PageRank-style centrality scores for all entities in the graph.
     * Uses iterative power method with damping factor.
     */
    async calculateCentrality(): Promise<Map<string, number>> {
        const lastCount = await this.storage.get<number>('last_pagerank_node_count') || 0;
        const currentCountRow = this.storage.sql.exec('SELECT COUNT(*) as count FROM graph_nodes').toArray()[0] as any;
        const currentCount = currentCountRow?.count || 0;

        if (currentCount > 0 && (currentCount - lastCount) < 100 && lastCount > 0) {
            console.log(`[PredictiveEngine] Skipping PageRank. Nodes added since last run: ${currentCount - lastCount} (Threshold: 100)`);
            // Load existing centrality scores from DB to return
            const existingScores = new Map<string, number>();
            const nodes = this.storage.sql.exec('SELECT id, centrality FROM graph_nodes').toArray() as any[];
            nodes.forEach(n => existingScores.set(n.id, n.centrality || 0));
            return existingScores;
        }

        console.log(`[PredictiveEngine] Executing PageRank for ${currentCount} nodes...`);
        const dampingFactor = 0.85;
        const iterations = 20;
        const tolerance = 0.0001;

        // Get all nodes and edges
        const nodes = this.storage.sql.exec('SELECT DISTINCT id FROM graph_nodes').toArray() as any[];
        const edges = this.storage.sql.exec('SELECT source, target, weight FROM graph_edges').toArray() as any[];

        if (nodes.length === 0) return new Map();

        // Initialize scores
        const scores = new Map<string, number>();
        const outDegrees = new Map<string, number>();

        nodes.forEach(n => {
            scores.set(n.id, 1.0 / nodes.length);
            outDegrees.set(n.id, 0);
        });

        // Calculate out-degrees
        edges.forEach((e: any) => {
            outDegrees.set(e.source, (outDegrees.get(e.source) || 0) + (e.weight || 1));
        });

        // Build adjacency list
        const inLinks = new Map<string, Array<{ from: string, weight: number }>>();
        nodes.forEach(n => inLinks.set(n.id, []));

        edges.forEach((e: any) => {
            const links = inLinks.get(e.target) || [];
            links.push({ from: e.source, weight: e.weight || 1 });
            inLinks.set(e.target, links);
        });

        // Power iteration
        for (let iter = 0; iter < iterations; iter++) {
            const newScores = new Map<string, number>();
            let maxChange = 0;

            nodes.forEach(n => {
                const nodeId = n.id;
                let sum = 0;

                const incoming = inLinks.get(nodeId) || [];
                incoming.forEach(link => {
                    const sourceScore = scores.get(link.from) || 0;
                    const sourceDegree = outDegrees.get(link.from) || 1;
                    sum += (sourceScore / sourceDegree) * link.weight;
                });

                const newScore = (1 - dampingFactor) / nodes.length + dampingFactor * sum;
                newScores.set(nodeId, newScore);

                const change = Math.abs(newScore - (scores.get(nodeId) || 0));
                maxChange = Math.max(maxChange, change);
            });

            scores.clear();
            newScores.forEach((v, k) => scores.set(k, v));

            if (maxChange < tolerance) break;
        }

        await this.storage.put('last_pagerank_node_count', currentCount);
        return scores;
    }

    /**
     * Aggregate sentiment for each entity over time windows.
     * Calculates weighted average sentiment and velocity (rate of change).
     */
    aggregateSentiment(timeWindowHours: number = 24): Map<string, { sentiment: number, velocity: number }> {
        const windowMs = timeWindowHours * 60 * 60 * 1000;
        const now = Date.now();
        const cutoff = now - windowMs;

        // Get recent sentiment snapshots
        const snapshots = this.storage.sql.exec(
            'SELECT entity_id, sentiment, relevance_score, timestamp FROM sentiment_snapshots WHERE timestamp > ? ORDER BY timestamp ASC',
            cutoff
        ).toArray() as any[];

        const entityData = new Map<string, Array<{ sentiment: number, weight: number, time: number }>>();

        snapshots.forEach((snap: any) => {
            if (!entityData.has(snap.entity_id)) {
                entityData.set(snap.entity_id, []);
            }
            entityData.get(snap.entity_id)!.push({
                sentiment: snap.sentiment,
                weight: snap.relevance_score || 1.0,
                time: snap.timestamp
            });
        });

        const results = new Map<string, { sentiment: number, velocity: number }>();

        entityData.forEach((data, entityId) => {
            if (data.length === 0) {
                results.set(entityId, { sentiment: 0, velocity: 0 });
                return;
            }

            // Calculate weighted average sentiment
            let weightedSum = 0;
            let weightTotal = 0;
            data.forEach(d => {
                // Apply recency weighting (more recent = higher weight)
                const recencyFactor = (d.time - cutoff) / windowMs;
                const finalWeight = d.weight * (0.5 + 0.5 * recencyFactor);
                weightedSum += d.sentiment * finalWeight;
                weightTotal += finalWeight;
            });

            const avgSentiment = weightTotal > 0 ? weightedSum / weightTotal : 0;

            // Calculate velocity (sentiment momentum)
            let velocity = 0;
            if (data.length >= 2) {
                const halfWindow = windowMs / 2;
                const midPoint = cutoff + halfWindow;

                const recent = data.filter(d => d.time >= midPoint);
                const older = data.filter(d => d.time < midPoint);

                if (recent.length > 0 && older.length > 0) {
                    const recentAvg = recent.reduce((sum, d) => sum + d.sentiment, 0) / recent.length;
                    const olderAvg = older.reduce((sum, d) => sum + d.sentiment, 0) / older.length;
                    velocity = recentAvg - olderAvg;
                }
            }

            results.set(entityId, { sentiment: avgSentiment, velocity });
        });

        return results;
    }

    /**
     * Calculate conviction scores combining centrality, sentiment, and velocity.
     * Higher conviction = stronger signal quality.
     */
    async calculateConvictionScores(): Promise<EntityMetrics[]> {
        const centrality = await this.calculateCentrality();
        const sentimentData = this.aggregateSentiment(24);

        // Get all entities
        const entities = this.storage.sql.exec(
            'SELECT id, label, type FROM graph_nodes WHERE type = "entity"'
        ).toArray() as any[];

        // Get signal counts for each entity
        const signalCounts = new Map<string, number>();
        const signalCountRows = this.storage.sql.exec(`
            SELECT entity_id, COUNT(*) as cnt 
            FROM sentiment_snapshots 
            WHERE timestamp > ?
            GROUP BY entity_id
        `, Date.now() - 7 * 24 * 60 * 60 * 1000).toArray() as any[];

        signalCountRows.forEach((row: any) => {
            signalCounts.set(row.entity_id, row.cnt);
        });

        const metrics: EntityMetrics[] = entities.map((entity: any) => {
            const cent = centrality.get(entity.id) || 0;
            const sent = sentimentData.get(entity.id) || { sentiment: 0, velocity: 0 };
            const signalCount = signalCounts.get(entity.id) || 0;

            // Conviction formula: weighted combination of factors
            // - Centrality (0-1): importance in the graph
            // - Sentiment magnitude (0-1): strength of sentiment
            // - Velocity (momentum): rate of sentiment change
            // - Signal frequency: how often mentioned
            const normalizedCentrality = Math.min(cent * 10, 1); // Scale up centrality
            const sentimentMagnitude = Math.abs(sent.sentiment);
            const normalizedVelocity = Math.tanh(Math.abs(sent.velocity) * 2); // Sigmoid-like normalization
            const frequencyBoost = Math.min(signalCount / 10, 1); // Cap at 10 signals

            const conviction = (
                normalizedCentrality * 0.3 +
                sentimentMagnitude * 0.3 +
                normalizedVelocity * 0.2 +
                frequencyBoost * 0.2
            );

            return {
                id: entity.id,
                label: entity.label,
                type: entity.type,
                centrality: cent,
                sentiment_score: sent.sentiment,
                velocity: sent.velocity,
                conviction_score: conviction,
                signal_count: signalCount,
                last_updated: Date.now()
            };
        });

        // Sort by conviction score descending
        return metrics.sort((a, b) => b.conviction_score - a.conviction_score);
    }

    /**
     * Update entity metrics in the database.
     */
    updateEntityMetrics(metrics: EntityMetrics[]): void {
        metrics.forEach(m => {
            this.storage.sql.exec(`
                UPDATE graph_nodes 
                SET centrality = ?, sentiment_score = ?, velocity = ?, conviction_score = ?, last_updated = ?
                WHERE id = ?
            `, m.centrality, m.sentiment_score, m.velocity, m.conviction_score, m.last_updated, m.id);
        });
    }

    /**
     * Record a sentiment snapshot for backtesting and trend analysis.
     */
    recordSentiment(entityId: string, sentiment: number, signalId: string, relevanceScore: number): void {
        this.storage.sql.exec(`
            INSERT INTO sentiment_snapshots (id, entity_id, timestamp, sentiment, signal_id, relevance_score)
            VALUES (?, ?, ?, ?, ?, ?)
        `,
            crypto.randomUUID(),
            entityId,
            Date.now(),
            sentiment,
            signalId,
            relevanceScore
        );
    }

    /**
     * Generate predictive signal when conviction score crosses threshold.
     */
    generatePrediction(entityId: string, label: string, conviction: number, sentiment: number): Prediction | null {
        const THRESHOLD = 0.7; // High conviction threshold

        if (conviction < THRESHOLD) return null;

        let predictionType: 'bullish' | 'bearish' | 'neutral' = 'neutral';
        if (sentiment > 0.3) predictionType = 'bullish';
        else if (sentiment < -0.3) predictionType = 'bearish';

        const prediction: Prediction = {
            id: crypto.randomUUID(),
            entity_id: entityId,
            prediction_type: predictionType,
            conviction_score: conviction,
            predicted_at: Date.now(),
            outcome: 'pending'
        };

        // Store prediction
        this.storage.sql.exec(`
            INSERT INTO predictions (id, entity_id, prediction_type, conviction_score, predicted_at, outcome)
            VALUES (?, ?, ?, ?, ?, ?)
        `,
            prediction.id,
            prediction.entity_id,
            prediction.prediction_type,
            prediction.conviction_score,
            prediction.predicted_at,
            prediction.outcome
        );

        return prediction;
    }

    /**
     * Get backtesting results - accuracy of past predictions.
     */
    getBacktestResults(): {
        totalPredictions: number;
        correct: number;
        incorrect: number;
        pending: number;
        accuracy: number;
    } {
        const stats = this.storage.sql.exec(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN outcome = 'correct' THEN 1 ELSE 0 END) as correct,
                SUM(CASE WHEN outcome = 'incorrect' THEN 1 ELSE 0 END) as incorrect,
                SUM(CASE WHEN outcome = 'pending' THEN 1 ELSE 0 END) as pending
            FROM predictions
        `).toArray()[0] as any;

        const total = stats?.total || 0;
        const correct = stats?.correct || 0;
        const incorrect = stats?.incorrect || 0;
        const pending = stats?.pending || 0;
        const accuracy = total > 0 ? correct / (correct + incorrect || 1) : 0;

        return {
            totalPredictions: total,
            correct,
            incorrect,
            pending,
            accuracy
        };
    }

    /**
     * Get sentiment history for a specific entity.
     */
    getSentimentHistory(entityId: string, daysBack: number = 30): SentimentSnapshot[] {
        const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

        const snapshots = this.storage.sql.exec(
            'SELECT * FROM sentiment_snapshots WHERE entity_id = ? AND timestamp > ? ORDER BY timestamp DESC',
            entityId,
            cutoff
        ).toArray() as any[];

        return snapshots;
    }

    async tick(): Promise<Prediction[]> {
        console.log('🔮 PredictiveEngine: Running analysis cycle...');

        // Calculate and update metrics
        const metrics = await this.calculateConvictionScores();
        this.updateEntityMetrics(metrics);

        // Generate predictions for high-conviction entities
        const predictions: Prediction[] = [];
        metrics.slice(0, 10).forEach(m => {
            if (m.conviction_score > 0.7) {
                const pred = this.generatePrediction(m.id, m.label, m.conviction_score, m.sentiment_score);
                if (pred) predictions.push(pred);
            }
        });

        console.log(`✅ Updated ${metrics.length} entities, generated ${predictions.length} predictions`);
        return predictions;
    }
}
