import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ContentDO } from './ContentDO';

// Mock cloudflare:workers to avoid DurableObjectBase validation issues in unit tests
vi.mock('cloudflare:workers', () => {
    return {
        DurableObject: class {
            ctx: any;
            env: any;
            constructor(ctx: any, env: any) {
                this.ctx = ctx;
                this.env = env;
            }
        }
    };
});

// Mock TelegramManager and external libraries
vi.mock('./telegram', () => {
    return {
        TelegramManager: vi.fn().mockImplementation(() => ({
            connect: vi.fn().mockResolvedValue('test-session'),
            isLoggedIn: vi.fn().mockResolvedValue(true),
            sendMessage: vi.fn(),
            listen: vi.fn(),
            getClient: vi.fn().mockReturnValue({ connected: true })
        }))
    };
});

vi.mock('./utils/rss', () => ({
    fetchAndParseRSS: vi.fn()
}));

// Mock types and dependencies
const mockEnv = {
    GEMINI_API_KEY: 'test-key',
    TELEGRAM_API_ID: '123',
    TELEGRAM_API_HASH: 'hash'
};

describe('ContentDO', () => {
    let mockState: any;
    let contentDO: ContentDO;
    let mockStorage: any;

    beforeEach(() => {
        mockStorage = {
            sql: {
                exec: vi.fn().mockReturnValue({ toArray: () => [], one: () => null })
            },
            put: vi.fn(),
            get: vi.fn(),
            setAlarm: vi.fn(),
            getAlarm: vi.fn().mockResolvedValue(null)
        };
        mockState = {
            storage: mockStorage,
            getWebSockets: () => [],
            blockConcurrencyWhile: async (cb: any) => await cb()
        };
        contentDO = new ContentDO(mockState, mockEnv as any);
    });

    describe('isRateLimited', () => {
        test('permits requests under threshold', () => {
            const request = new Request('https://api.test/signals', {
                headers: { 'cf-connecting-ip': '1.1.1.1' }
            });
            expect((contentDO as any).isRateLimited(request)).toBe(false);
        });

        test('blocks requests over threshold', () => {
            const request = new Request('https://api.test/signals', {
                headers: { 'cf-connecting-ip': '2.2.2.2' }
            });
            // Simulate 60 requests
            for (let i = 0; i < 60; i++) {
                (contentDO as any).isRateLimited(request);
            }
            expect((contentDO as any).isRateLimited(request)).toBe(true);
        });
    });

    describe('Caching Logic', () => {
        test('sets and gets cache correctly', () => {
            const testData = { signals: [] };
            (contentDO as any).setCache('signal', testData);
            expect((contentDO as any).getCache('signal')).toEqual(testData);
        });

        test('invalidates cache correctly', () => {
            (contentDO as any).setCache('signal', { data: 1 });
            (contentDO as any).invalidateCache();
            expect((contentDO as any).getCache('signal')).toBeNull();
        });

        test('cache expires after TTL', async () => {
            (contentDO as any).CACHE_TTL = 10; // 10ms for test
            (contentDO as any).setCache('signal', { data: 1 });
            await new Promise(r => setTimeout(r, 20));
            expect((contentDO as any).getCache('signal')).toBeNull();
        });
    });

    describe('Utility Logic', () => {
        test('generateContentHash creates valid hex hash', async () => {
            const text = "Hello World";
            const hash = await (contentDO as any).generateContentHash(text);
            expect(hash).toMatch(/^[a-f0-9]{64}$/);
        });

        test('different text yields different hash', async () => {
            const h1 = await (contentDO as any).generateContentHash("text1");
            const h2 = await (contentDO as any).generateContentHash("text2");
            expect(h1).not.toBe(h2);
        });
    });

    describe('API Handlers', () => {
        test('/health returns healthy status', async () => {
            const request = new Request('https://api.test/health');
            const response = await contentDO.fetch(request);
            const data = await response.json() as any;
            expect(data.status).toBe('online');
        });

        test('/signals/search applies rate limiting', async () => {
            const request = new Request('https://api.test/signals/search', {
                headers: { 'cf-connecting-ip': '3.3.3.3' }
            });
            // Bombard with 61 requests
            for (let i = 0; i < 60; i++) {
                await contentDO.fetch(request);
            }
            const response = await contentDO.fetch(request);
            expect(response.status).toBe(429);
        });
    });
});
