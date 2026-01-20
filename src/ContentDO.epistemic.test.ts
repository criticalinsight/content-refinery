
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ContentDO } from './ContentDO';

// Mock cloudflare:workers
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

// Mock TelegramManager
const mockSendMessage = vi.fn();
vi.mock('./telegram', () => {
    return {
        TelegramManager: vi.fn().mockImplementation(() => ({
            connect: vi.fn().mockResolvedValue('test-session'),
            isLoggedIn: vi.fn().mockResolvedValue(true),
            isLoggedIn: vi.fn().mockResolvedValue(true),
            sendMessage: mockSendMessage,
            listen: vi.fn(),
            getClient: vi.fn().mockReturnValue({ connected: true })
        }))
    };
});

// Mock dependencies
vi.mock('./utils/rss', () => ({ fetchAndParseRSS: vi.fn() }));

// Mock fetch for Gemini API
const globalFetch = vi.fn();
global.fetch = globalFetch;

const mockEnv = {
    GEMINI_API_KEY: 'test-key',
    TELEGRAM_API_ID: '123',
    TELEGRAM_API_HASH: 'hash'
};

describe('ContentDO Epistemic & Buttons', () => {
    let contentDO: ContentDO;
    let mockSqlExec: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSqlExec = vi.fn();
        
        const mockStorage = {
            sql: { exec: mockSqlExec },
            put: vi.fn(),
            get: vi.fn(),
            setAlarm: vi.fn(),
            getAlarm: vi.fn().mockResolvedValue(null)
        };
        
        contentDO = new ContentDO({ 
            storage: mockStorage, 
            getWebSockets: () => [],
            blockConcurrencyWhile: async (callback: any) => await callback()
        } as any, mockEnv as any);
    });

    describe('handleCallback (Button Routing)', () => {
        test('routes "chk" (Fact Check) correctly', async () => {
            // Setup DB mock to return a signal
            mockSqlExec.mockReturnValue({ toArray: () => [{ id: '123', raw_text: 'Test Content', source_name: 'Test Source' }] });
            
            // Mock Gemini response
            globalFetch.mockResolvedValue({
                json: async () => ({ candidates: [{ content: { parts: [{ text: 'Fact Check Result' }] } }] })
            });

            // Trigger callback via handleIngestInternal logic or direct internal method access
            // Since handleCallback is private, we can simulate the "CALLBACK:chk:123" message flow via handleIngestInternal
            await contentDO.fetch(new Request('https://api/ingest', {
                method: 'POST',
                body: JSON.stringify({
                    chatId: '999',
                    messageId: 1,
                    text: 'CALLBACK:chk:123',
                    title: 'Test',
                    date: 123
                })
            }));

            // Verify loading message
            expect(mockSendMessage).toHaveBeenCalledWith('999', expect.stringContaining('Running <b>🔎 FACT CHECK'));
            
            // Verify Gemini called with correct prompt identifier (part of the prompt text)
            expect(globalFetch).toHaveBeenCalledWith(
                expect.stringContaining('generativelanguage.googleapis.com'),
                expect.objectContaining({
                    body: expect.stringContaining('Forensic Fact-Checker')
                })
            );

            // Verify final output
            expect(mockSendMessage).toHaveBeenCalledWith('999', expect.stringContaining('Fact Check Result'));
        });

        test('routes "syn" (Synthesis) correctly', async () => {
            mockSqlExec.mockReturnValue({ toArray: () => [{ id: '123', raw_text: 'Test Content' }] });
            globalFetch.mockResolvedValue({
                json: async () => ({ candidates: [{ content: { parts: [{ text: 'Synthesis Result' }] } }] })
            });

            await contentDO.fetch(new Request('https://api/ingest', {
                method: 'POST',
                body: JSON.stringify({ chatId: '999', messageId: 1, text: 'CALLBACK:syn:123', title: 'Test', date: 123 })
            }));

            expect(mockSendMessage).toHaveBeenCalledWith('999', expect.stringContaining('Running <b>⚡ SYNTHESIS'));
            expect(globalFetch).toHaveBeenCalledWith(
                expect.stringContaining('generativelanguage.googleapis.com'),
                expect.objectContaining({ body: expect.stringContaining('Portfolio Manager') })
            );
        });

        test('routes "div" (Deep Dive) correctly', async () => {
            mockSqlExec.mockReturnValue({ toArray: () => [{ id: '123', raw_text: 'Test Content' }] });
            globalFetch.mockResolvedValue({
                json: async () => ({ candidates: [{ content: { parts: [{ text: 'Deep Dive Result' }] } }] })
            });

            await contentDO.fetch(new Request('https://api/ingest', {
                method: 'POST',
                body: JSON.stringify({ chatId: '999', messageId: 1, text: 'CALLBACK:div:123', title: 'Test', date: 123 })
            }));

            expect(mockSendMessage).toHaveBeenCalledWith('999', expect.stringContaining('Running <b>🧠 DEEP DIVE'));
            expect(globalFetch).toHaveBeenCalledWith(
                expect.stringContaining('generativelanguage.googleapis.com'),
                expect.objectContaining({ body: expect.stringContaining('Epistemic Analyst') })
            );
        });

        test('handles invalid/expired signal ID', async () => {
            mockSqlExec.mockReturnValue({ toArray: () => [] }); // No result

            await contentDO.fetch(new Request('https://api/ingest', {
                method: 'POST',
                body: JSON.stringify({ chatId: '999', messageId: 1, text: 'CALLBACK:chk:999', title: 'Test', date: 123 })
            }));

            expect(mockSendMessage).toHaveBeenCalledWith('999', '❌ Signal not found or expired.');
        });
    });
});
