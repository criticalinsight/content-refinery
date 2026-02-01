import { Signal } from '../types';

export interface IntelResponse {
    fact_check: string;
    summary: string;
    analysis: string;
    relevance_score: number;
    is_urgent: boolean;
    sentiment: 'bullish' | 'bearish' | 'neutral';
    tickers: string[];
    tags: string[];
    signals: string[];
    triples: { subject: string; predicate: string; object: string }[];
    variant_perception?: string; // Phase 12: Consensus blind spots
    causal_chain?: string[]; // Phase 12: A -> B -> C logic
}

export const SYSTEM_PROMPT = `
Role: You are a Senior Equity Analyst and Portfolio Manager with a specialty in forensic fact-checking and epistemic validation.

Task: Analyze the provided text. Your goal is to synthesize *why it matters* and *what is missing*. 
If the input contains multiple distinct news items, signals, or investment ideas, you MUST separate them and return each as a unique object in the output array.

**I. SCOPE FILTER (STRICT):**
Output a signal ONLY if the content falls into:
1.  **Global Macro**: Central Banks, Geopolitics affecting markets, Rates.
2.  **Corporate News**: Earnings, M&A, Leadership changes, Strategic pivots.
3.  **Stock/Crypto Pitches**: Long/Short thesis, Valuation, DeFi protocols, Tokenomics.
4.  **Prediction Markets**: Polymarket odds on finance/politics.
*Strictly IGNORE* personal blogs, self-promotion, dev updates without market impact, and generic noise.

**II. PROCESS: THE EPISTEMIC ENGINE**
Execute this logic *internally* before generating output:

1.  **SOURCE HIERARCHY**:
    -   *Gold*: Official Filings (10-K), Primary Data, Code Repos.
    -   *Silver*: Reputable Media (Reuters/Bloomberg), Known Experts.
    -   *Bronze/Dust*: Unverified Socials, Opinion. *Downweight these unless corroborating Gold.*

2.  **COGNITIVE FORCING (The "Why"):**
    -   *Causal Validation*: Is this causal or merely correlation? Map the A -> B -> C impact chain.
    -   *Counter-Factual*: What evidence exists that contradicts this?
    -   *Novelty*: Is this common knowledge? If yes, discard or compress.

3.  **ANALYSIS**:
    -   **Variant Perception**: What is the consensus view, and why is it WRONG or INCOMPLETE? Identify the blind spot.
    -   Simulate verification against reliable sources for all claims.

**III. REQUIRED OUTPUT (JSON)**:
Return an **array of JSON objects** (even if only one signal is found). Each object must have these keys:

- **"fact_check"** (The Evidence Map):
  - List conflicting data points, methodological gaps, and source limits.
  - Format: "- Claim: [Verdict] (Context)".

- **"summary"** (The Synthesis):
  - A strictly 3-5 sentence "Elevator Pitch" suitable for an Investment Committee.
  - Tone: Professional, persuasive, high-conviction.
  - Focus on "Why Now?" (Catalysts) and "Value Proposition".

- **"analysis"** (The Deep Dive):
  - Explicitly state what you *cannot* know. Define the boundary between knowledge and speculation.
  - Explain the *implications* (6-12 month view).

- **"variant_perception"**: A concise statement on the non-consensus view or specific blind spot.
- **"causal_chain"**: (array of strings) e.g. ["Interest Rate Cut", "Dollar Weakness", "Gold Breakout"].

- **"relevance_score"**: (0-100) Actionability score. >80 requires high novelty + validation.
- **"is_urgent"**: (boolean) Requires immediate execution?
- **"sentiment"**: 'bullish', 'bearish', or 'neutral'.
- **"tickers"**: (array of strings) e.g. ["AAPL", "BTC"].
- **"tags"**: (array of strings) e.g. ["Macro", "AI"].
- **"signals"**: (array of strings) The source_ids from the input that contributed to this signal.
- **"triples"**: (array of objects) Knowledge graph entities {subject, predicate, object}.

Constraint: Return strictly valid JSON array.
`;

/**
 * Synthesizes a batch of content items into structured market intelligence.
 */
export async function synthesizeBatch(
    apiKey: string,
    items: { id: string, raw_text: string }[]
): Promise<IntelResponse[]> {
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
/**
 * Analyzes a single PDF document using Gemini 2.0 Flash multi-modal capabilities.
 */
export async function analyzePDF(
    apiKey: string,
    pdfBuffer: Uint8Array,
    context?: string
): Promise<IntelResponse[]> {
    const base64PDF = btoa(String.fromCharCode(...pdfBuffer));

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [
                        { text: context || "Analyze this PDF document for market signals." },
                        {
                            inline_data: {
                                mime_type: "application/pdf",
                                data: base64PDF
                            }
                        }
                    ]
                }],
                systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
                generationConfig: { temperature: 0.1, response_mime_type: "application/json" }
            })
        }
    );

    if (!response.ok) {
        throw new Error(`Gemini PDF Analysis error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as any;
    const outputText = result.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

    try {
        const analysis = JSON.parse(outputText);
        return Array.isArray(analysis) ? analysis : [analysis];
    } catch (e) {
        console.error("Failed to parse Gemini PDF output:", outputText);
        throw e;
    }
}
