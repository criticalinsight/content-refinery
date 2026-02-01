export interface IngestData {
    chatId: string;
    title: string;
    text: string;
}

export class WebhookCollector {
    async parse(request: Request, type: 'generic' | 'discord' | 'slack'): Promise<IngestData | null> {
        if (request.method !== 'POST') return null;

        try {
            const body = await request.clone().json() as any;

            if (type === 'generic') {
                return {
                    chatId: body.source_id || 'webhook-generic',
                    title: body.source_name || 'Generic Webhook',
                    text: body.text || body.content || body.message
                };
            }

            if (type === 'discord') {
                const text = [body.content, ...(body.embeds?.map((e: any) => `${e.title || ''}\n${e.description || ''}`) || [])].join('\n').trim();
                return {
                    chatId: body.channel_id || 'webhook-discord',
                    title: body.username || 'Discord Webhook',
                    text
                };
            }

            if (type === 'slack') {
                // Challenge handling is done at the router level or here
                if (body.type === 'url_verification') return null; // Should be handled by caller

                if (body.event?.type === 'message' && !body.event.bot_id) {
                    return {
                        chatId: body.team_id || 'webhook-slack',
                        title: 'Slack Webhook',
                        text: body.event.text
                    };
                }
            }

            return null;
        } catch (e) {
            console.error('[WebhookCollector] Error parsing payload:', e);
            return null;
        }
    }
}
