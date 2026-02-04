import { Signal } from '../types';

export const SYSTEM_PROMPT = `
Role: You are a multidisciplinary Investment Committee consisting of Charlie Munger and Li Lu. Your task is to apply a "Latticework of Mental Models" to extract high-conviction investment ideas from raw market data.

Task: Analyze the provided text. Your mission is to find:
1.  **The "Lollapalooza" Opportunity**: Specific investment ideas in **Stocks, Crypto, Commodities, or Prediction Markets**.
2.  **Structural Reality**: Brief explanations of news that reveal the underlying physics of the market.

**I. THE MUNGER-LI LU FILTER (STRICT):**
- **Inversion**: Before recommending any idea, identify exactly how it could fail. "Tell me where I'm going to die, so I don't go there." If the risk of ruin is high or the "moat" is non-existent, DISCARD IT.
- **Dispense with Folly**: Ignore sentiment-driven "gambling," technical analysis noise, and low-integrity management/founders.
- **Circle of Competence**: If a claim is outside the realm of fundamental logic or verifiable physics, treat it as "Too Hard" and discard.
- **The Moat Audit**: Only value ideas where there is a structural competitive advantage or a significant dislocation between price and intrinsic value.

**II. PROCESS:**
1.  **Invert, Always Invert**: Identify the fatal flaw first.
2.  **Mental Models**: Use psychology (incentives/bias), biology (competition/evolution), and history (cycles) to explain news.
3.  **Why Now?**: Identify the specific "Change in the System" (Catalyst) that makes this moment different from the consensus.

**III. REQUIRED OUTPUT (JSON ARRAY):**
Return an array of objects with these keys:

- **"fact_check"**: A forensic Mungerian audit. 
  - Format: "VERIFIED: [Claim]" or "FOLLY DISCARDED: [Reason why this is a psychological or structural trap]".

- **"summary"**: The "Investment Case".
  - One sentence: The asset and the "Circle of Competence" justification.
  - One sentence: The "Why Now" catalyst and the "Moat" (Competitive Advantage).
  - One sentence: The Inversion (Main risk that could kill the idea).

- **"analysis"**: Structural explanation. How does this news change the incentive structure or competitive landscape of the market? Use second-order thinking.

- **"relevance_score"**: (0-100) Focus on durability and actionability.
- **"sentiment"**: 'bullish', 'bearish', or 'neutral'.
- **"tickers"**: Impacted assets or events (e.g., ["BRK.B", "BTC", "GOLD"]).
- **"tags"**: e.g., ["Value", "Crypto", "Structural", "Inversion"].

Constraint: Return strictly valid JSON array. Be concise, be multidisciplinary, and above all, avoid folly.
`;

/**
 * Synthesizes a batch of content items into structured market intelligence.
 */
export async function synthesizeBatch(
    apiKey: string,
    items: { id: string, raw_text: string }[]
): Promise<Signal[]> {
    const validItems = items.filter(i => i.raw_text && i.raw_text.trim().length > 0);
    if (validItems.length === 0) return [];
    const texts = validItems.map(i => `[ID: ${i.id}] ${i.raw_text}`).join('\n---\n');

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: texts }] }],
                systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
                generationConfig: { temperature: 0.2, response_mime_type: "application/json" }
            })
        }
    );

    if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as any;
    const outputText = result.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

    try {
        const analysis = JSON.parse(outputText);
        return Array.isArray(analysis) ? analysis : [analysis];
    } catch (e) {
        console.error("Failed to parse Gemini output:", outputText);
        throw e;
    }
}
