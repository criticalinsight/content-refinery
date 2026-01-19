import { describe, test, expect, vi, beforeEach } from 'vitest';
import { ErrorLogger } from './ErrorLogger';

describe('ErrorLogger', () => {
    let mockStorage: any;
    let logger: ErrorLogger;

    beforeEach(() => {
        mockStorage = {
            sql: {
                exec: vi.fn().mockReturnValue({ toArray: () => [] })
            }
        };
        logger = new ErrorLogger(mockStorage);
    });

    test('logs a simple error string', async () => {
        await logger.log('TestModule', 'Something went wrong');

        expect(mockStorage.sql.exec).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO internal_errors'),
            expect.any(String),
            'TestModule',
            'Something went wrong',
            '',
            null,
            expect.any(Number)
        );
    });

    test('logs an Error object with stack trace', async () => {
        const error = new Error('Database connection failed');
        await logger.log('Database', error, { retry: true });

        expect(mockStorage.sql.exec).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO internal_errors'),
            expect.any(String),
            'Database',
            'Database connection failed',
            expect.stringContaining('Error: Database connection failed'),
            JSON.stringify({ retry: true }),
            expect.any(Number)
        );
    });

    test('handles storage failures gracefully', async () => {
        mockStorage.sql.exec.mockImplementation(() => {
            throw new Error('Storage Full');
        });

        // Should not throw
        await expect(logger.log('Critical', 'Crash')).resolves.not.toThrow();
    });
});
