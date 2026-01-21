export interface Env {
    CONTENT_DO: DurableObjectNamespace;
    VECTOR_INDEX: VectorizeIndex;
    AI: any; // Cloudflare AI
    GEMINI_API_KEY: string;
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_API_ID: string;
    TELEGRAM_API_HASH: string;
    BOARD_DO_URL?: string; // Phase 24: New URL for the BoardDO service if separate
    VAPID_PUBLIC_KEY: string;
    VAPID_PRIVATE_KEY: string;
}

export interface Signal {
    summary: string;
    relevance_score: number;
    sentiment: 'positive' | 'negative' | 'neutral';
    tickers: string[];
    analysis: string;
    fact_check?: string;
    is_urgent?: boolean;
    confidence?: number;
}

export interface Entity {
    name: string;
    type: 'company' | 'person' | 'location' | 'crypto';
    sentiment: number; // -1.0 to 1.0
}

export interface Narrative {
    title: string;
    description: string;
    related_signals: string[]; // Signal IDs
    coherence_score: number;
}

export interface ContentItem {
    id: string;
    source_id: string;
    source_name: string;
    raw_text: string;
    processed_json?: Signal | null; // Strict typing
    sentiment?: string;
    is_signal: number;
    retry_count: number;
    last_error?: string;
    created_at: number;
    metadata?: {
        content_hash?: string;
        tags?: string[];
        privacy?: 'public' | 'encrypted';
        platform?: 'telegram' | 'rss' | 'webhook';
        url?: string;
    };
}
