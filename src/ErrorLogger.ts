export class ErrorLogger {
    constructor(private storage: DurableObjectStorage) { }

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
