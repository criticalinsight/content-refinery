/**
 * ErrorLogger handles persistence of internal system errors to SQLite.
 * 
 * Time Complexity (Log): O(1) - SQL INSERT on non-indexed table is constant time.
 * Space Complexity: O(N) where N is the number of error entries.
 */
export class ErrorLogger {
    constructor(private storage: DurableObjectStorage) { }

    /**
     * Logs an error with context and stack trace.
     * @param module - The module where the error occurred (e.g., 'Telegram', 'AI')
     * @param error - The error object or string
     * @param context - Additional metadata for debugging
     */
    async log(module: string, error: any, context?: any) {
        const id = crypto.randomUUID();
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : '';
        const timestamp = Date.now();

        console.error(`[${module}] Error: ${message}`, { context, stack });

        try {
            this.storage.sql.exec(
                'INSERT INTO internal_errors (id, module, message, stack, context, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                id,
                module,
                message,
                stack,
                context ? JSON.stringify(context) : null,
                timestamp
            );
        } catch (e) {
            console.error("Critical: Failed to log error to database", e);
        }
    }
}
