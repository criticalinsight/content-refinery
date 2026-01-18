export interface Env {
    CONTENT_DO: DurableObjectNamespace;
    GEMINI_API_KEY: string;
    TELEGRAM_BOT_TOKEN: string;
    BOARD_DO_URL?: string; // Phase 24: New URL for the BoardDO service if separate
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
