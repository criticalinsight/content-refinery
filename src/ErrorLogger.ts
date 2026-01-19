/**
 * ErrorLogger handles persistence of internal system errors to SQLite.
 * 
 * Time Complexity (Log): O(1) - SQL INSERT on non-indexed table is constant time.
 * Space Complexity: O(N) where N is the number of error entries.
 */
export class ErrorLogger {
    constructor(private storage: DurableObjectStorage) { }

    private onCriticalError?: (module: string, message: string) => Promise<void>;

    setNotifyCallback(callback: (module: string, message: string) => Promise<void>) {
        this.onCriticalError = callback;
    }

    async log(module: string, error: any, context?: any) {
        const id = crypto.randomUUID();
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : '';
        const timestamp = Date.now();

        console.error(`[${module}] Error: ${message}`, { context, stack });

        if (this.onCriticalError) {
            this.onCriticalError(module, message).catch(() => { });
        }

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
