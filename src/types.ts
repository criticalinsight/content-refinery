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

export interface ContentItem {
    id: string;
    source_id: string;
    source_name: string;
    raw_text: string;
    processed_json?: any;
    sentiment?: string;
    is_signal: number;
    retry_count: number;
    last_error?: string;
    created_at: number;
    metadata?: Record<string, any>; // For Phase 2: Tweet IDs, RSS links, etc.
}
