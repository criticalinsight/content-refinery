
import { describe, test, expect, vi } from 'vitest';
import { fetchAndParseRSS } from './rss';
import { XMLParser } from 'fast-xml-parser';

// Mock XML Parser
vi.mock('fast-xml-parser', () => ({
    XMLParser: vi.fn().mockImplementation(() => ({
        parse: vi.fn()
    }))
}));

// Mock global fetch
const globalFetch = vi.fn();
global.fetch = globalFetch;

describe('utils/rss', () => {
    test('fetches and parses RSS feed', async () => {
        const mockXML = '<rss><channel><item><title>Test</title></item></channel></rss>';
        globalFetch.mockResolvedValue({
            ok: true,
            text: async () => mockXML
        });

        // Mock parser behavior
        const mockParse = vi.fn().mockReturnValue({
            rss: { channel: { item: [{ title: 'Test' }] } }
        });
        (XMLParser as any).mockImplementation(() => ({ parse: mockParse }));

        const result = await fetchAndParseRSS('https://test.com/rss');
        
        expect(globalFetch).toHaveBeenCalledWith('https://test.com/rss', expect.any(Object));
        expect(result).not.toBeNull();
        expect(result!.items.length).toBe(1);
        expect(result!.items[0].title).toBe('Test');
    });

    test('handles fetch errors', async () => {
        globalFetch.mockRejectedValue(new Error('Network Error'));
        const result = await fetchAndParseRSS('https://test.com/rss');
        expect(result).toBeNull();
    });
});
