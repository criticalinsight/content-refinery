import { IngestRequest } from '../types';

/**
 * TelegramBotCollector transforms raw Telegram Bot API updates into 
 * the application's standard IngestRequest format.
 */
export class TelegramBotCollector {
    static parseUpdate(update: any): IngestRequest | null {
        // Handle Messages
        if (update.message) {
            const msg = update.message;
            const chatId = msg.chat?.id?.toString();
            const messageId = msg.message_id?.toString();

            if (!chatId || !messageId) return null;

            // Extract text or caption
            let text = msg.text || msg.caption || "";

            // Handle Media (Photo/Document)
            let media = null;
            if (msg.photo) {
                // Return the largest photo file_id
                const largest = msg.photo[msg.photo.length - 1];
                media = { file_id: largest.file_id, type: 'photo' };
            } else if (msg.document) {
                media = { file_id: msg.document.file_id, type: 'document', mime_type: msg.document.mime_type };
            }

            return {
                chatId,
                messageId,
                title: msg.chat?.title || msg.from?.username || "Telegram",
                text,
                media: media as any // ContentDO will handle download via Bot API
            };
        }

        // Handle Callback Queries
        if (update.callback_query) {
            const query = update.callback_query;
            const msg = query.message;

            return {
                chatId: msg?.chat?.id?.toString() || "unknown",
                messageId: msg?.message_id?.toString() || "unknown",
                title: "Callback",
                text: `CALLBACK:${query.data}`,
                isCallback: true,
                queryId: query.id,
                data: query.data
            };
        }

        return null;
    }

    /**
     * Sends a message via Telegram Bot API.
     */
    static async sendMessage(token: string, chatId: string, text: string, buttons?: any[]) {
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        const body: any = {
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: false
        };

        if (buttons) {
            body.reply_markup = {
                inline_keyboard: buttons.map(row =>
                    row.map((btn: any) => ({
                        text: btn.text,
                        callback_data: btn.data
                    }))
                )
            };
        }

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const err = await res.text();
            console.error('[TelegramBotCollector] Send message failed:', err);
        }
    }

    /**
     * Downloads a file from Telegram via Bot API.
     */
    static async downloadFile(token: string, fileId: string): Promise<Uint8Array | null> {
        const getFileUrl = `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`;
        const res = await fetch(getFileUrl);
        if (!res.ok) return null;

        const { result } = await res.json() as any;
        const filePath = result.file_path;
        const downloadUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;

        const fileRes = await fetch(downloadUrl);
        if (!fileRes.ok) return null;

        const buffer = await fileRes.arrayBuffer();
        return new Uint8Array(buffer);
    }
}
