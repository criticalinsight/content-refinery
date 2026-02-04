# Content Refinery: The Alpha Pipe

**Distilled Telegram-to-Gemini Intelligence Conduit**

Content Refinery (V3.0) is a simplified, high-performance Cloudflare Workers application that transforms raw Telegram noise into actionable market intelligence. It decomplects the complex ingestion process into a singular "Alpha Pipe."

## Core Flow (The Pipe)

1.  **Ingest**: Stateless Telegram Bot API webhook listener.
2.  **Deduplicate**: Content-hash check via SQLite to prevent redundant processing.
3.  **Analyze**: Munger-Li Lu "Latticework" protocol for multidisciplinary alpha extraction.
4.  **Mirror**: Delivery of "tl;dr takes" with forensic audits and structural analysis.

## Features

-   **Mungerian Intelligence**: AI agent embodying Charlie Munger and Li Lu—using inversion and mental models to filter folly.
-   **Zero Accidental Complexity**: Removed auxiliary background agents and redundant storage operations.
-   **Operation Storm Prevention**: In-memory counters and hash deduplication to minimize SQL row reads.
-   **High-Density Output**: Minimal noise, 4000-character limited "tl;dr takes" with tickers and audit logs.

## Quick Start

```bash
# Development
npm run dev

# Typecheck
npm run typecheck

# Deploy
npm run deploy
```

## Documentation

-   [Product Requirements](./docs/PRD.md)
-   [Architecture & Design](./docs/ARCHITECTURE.md)
-   [Roadmap](./docs/ROADMAP.md)

## Stack

-   **Runtime**: Cloudflare Workers (Durable Objects)
-   **Logic**: Alpha Pipe (TypeScript)
-   **AI**: Gemini 2.5 Flash
-   **Storage**: SQLite (Durable Object Storage)

## License

Proprietary - Critical Insight © 2026
