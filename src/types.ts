export interface Env {
    CONTENT_DO: DurableObjectNamespace;
    VECTOR_INDEX: VectorizeIndex;
    AI: any;
    GEMINI_API_KEY: string;
    TELEGRAM_BOT_TOKEN: string;
    ALPHA_CHANNEL_ID?: string;
    ADMIN_CHANNEL_ID?: string;
}

export interface Signal {
    fact_check: string;
    summary: string;
    analysis: string;
    relevance_score: number;
    sentiment: 'bullish' | 'bearish' | 'neutral';
    tickers: string[];
    tags: string[];
}

export interface ContentItem {
    id: string;
    source_id: string;
    source_name: string;
    raw_text: string;
    processed_json?: Signal | null;
    is_signal: number;
    created_at: number;
    metadata?: {
        content_hash?: string;
        tags?: string[];
    };
}

export interface IngestRequest {
    chatId: string;
    messageId: string;
    title?: string;
    text: string;
}
