import { describe, test, expect, vi, beforeEach } from 'vitest';
import { TelegramManager } from './telegram';

// Mock Gram.js
vi.mock('telegram', () => {
    return {
        TelegramClient: vi.fn().mockImplementation(() => ({
            connect: vi.fn().mockResolvedValue(undefined),
            session: { save: vi.fn().mockReturnValue('mock-session-string') },
            addEventHandler: vi.fn(),
            connected: false
        })),
        sessions: {
            StringSession: vi.fn().mockImplementation((s) => ({ save: () => s || 'new-session' }))
        }
    };
});

describe('TelegramManager', () => {
    let mockEnv: any;
    let manager: TelegramManager;
    let onSessionUpdate: any;

    beforeEach(() => {
        mockEnv = { TELEGRAM_API_ID: '123', TELEGRAM_API_HASH: 'abc' };
        onSessionUpdate = vi.fn();
        manager = new TelegramManager(mockEnv, '', onSessionUpdate);
    });

    test('connects and triggers session update', async () => {
        const session = await manager.connect();
        expect(session).toBe('mock-session-string');
        expect(onSessionUpdate).toHaveBeenCalledWith('mock-session-string');
    });

    test('prevents duplicate listeners', () => {
        const handler = vi.fn();
        manager.listen(handler);
        manager.listen(handler); // Second call should be ignored

        // Check internal isListening flag via any cast if needed, 
        // but easier to check if addEventHandler was called once
        const client = (manager as any).client;
        expect(client.addEventHandler).toHaveBeenCalledTimes(1);
    });

    test('throws error if API credentials missing', async () => {
        const brokenManager = new TelegramManager({}, '');
        await expect(brokenManager.init()).rejects.toThrow('TELEGRAM_API_ID and TELEGRAM_API_HASH must be configured.');
    });
});
