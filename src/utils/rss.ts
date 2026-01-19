import { XMLParser } from 'fast-xml-parser';

export interface RSSItem {
    title: string;
    link: string;
    description: string;
    pubDate: string;
    content?: string;
    guid?: string;
}

export interface RSSFeed {
    title: string;
    description: string;
    link: string;
    items: RSSItem[];
}

export async function fetchAndParseRSS(url: string): Promise<RSSFeed | null> {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'ContentRefinery/1.0 (Cloudflare Worker)'
            }
        });

        if (!response.ok) {
            console.warn(`[RSS] Failed to fetch ${url}: ${response.status} ${response.statusText}`);
            return null;
        }

        const xmlData = await response.text();
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_"
        });
        const result = parser.parse(xmlData);

        let channel = result.rss?.channel || result.feed;
        if (!channel) return null;

        const itemsRaw = channel.item || channel.entry || [];
        const itemsArray = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw];

        const items: RSSItem[] = itemsArray.map((item: any) => ({
            title: item.title,
            link: item.link?.['@_href'] || item.link, // Atom vs RSS
            description: item.description || item.summary || '',
            pubDate: item.pubDate || item.updated || item.published || new Date().toISOString(),
            content: item['content:encoded'] || item.content || '',
            guid: item.guid?.['#text'] || item.guid || item.id || item.link
        }));

        return {
            title: channel.title,
            description: channel.description || '',
            link: channel.link?.['@_href'] || channel.link || url,
            items
        };
    } catch (e) {
        console.error(`[RSS] Error parsing ${url}:`, e);
        return null;
    }
}
