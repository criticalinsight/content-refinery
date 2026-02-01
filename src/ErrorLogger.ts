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

    async log(module: string, message: any, context?: any) {
        return this.logState(module, message, context);
    }

    async logState(module: string, message: any, context?: any) {
        const msgStr = typeof message === 'string' ? message : (message instanceof Error ? message.message : JSON.stringify(message));
        const id = crypto.randomUUID();
        const timestamp = Date.now();

        console.log(`[${module}] STATE: ${msgStr}`, context);

        try {
            this.storage.sql.exec(
                'INSERT INTO internal_errors (id, module, message, context, created_at) VALUES (?, ?, ?, ?, ?)',
                id,
                module,
                msgStr,
                context ? JSON.stringify(context) : null,
                timestamp
            );
        } catch (e) {
            console.error("Critical: Failed to log state to database", e);
        }

        // Trigger notification for critical errors if it's an actual error message or score is high
        if (this.onCriticalError && (module === 'ERROR' || module === 'CRITICAL')) {
            await this.onCriticalError(module, msgStr);
        }
    }
}
