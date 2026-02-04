# Operational Workflow: The Alpha Pipe

This document outlines the high-level workflow for operating and maintaining the Content Refinery (Alpha Pipe).

## 1. Ingestion Protocol
Data flows into the system via Telegram Bot API Webhooks.
- **Webhook Endpoint**: `/telegram-webhook`
- **Logic**: Every incoming message triggers a content-hash check against the SQLite `content_items` table.
- **De-duplication**: If the hash exists, the process stops immediately to save resources.

## 2. The Analysis Loop (Munger-Li Lu)
If the content is new and > 50 characters, it enters the **Epistemic Engine**.
- **The Filter**: Inversion and Moat analysis identify the structural reality.
- **The Synthesis**: Multiple ideas are de-interleaved into independent signals.
- **The Audit**: Claims are forensically verified or discarded as "Folly."

## 3. Mirroring & Delivery
Signals with a relevance score ≥ 80% are mirrored to the Alpha Channel.
- **Format**: `📌 tl;dr take` -> `[Analysis]` -> `[Sentiment/Relevance/Tickers]` -> `[Audit]`.
- **Constraint**: Automatic truncation at 4000 characters for Telegram API compatibility.

## 4. Maintenance & Monitoring
- **Stats**: View system metrics at the `/stats` endpoint.
- **Optimization**: The system uses in-memory counters for real-time indexing without SQL overhead.
- **Alerts**: System failures are transmitted to the defined Admin Channel.

## 5. Deployment
Always run the type checker before deploying to ensure the "uncomplected" schema remains intact.
```bash
npm run typecheck
npm run deploy
```
