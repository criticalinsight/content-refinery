# Content Refinery

**Telegram-First Market Intelligence Platform**

A Cloudflare Workers application that ingests financial news from multiple sources, applies AI-powered analysis, and outputs actionable market signals with source attribution.

## Features

- **Multi-Source Ingestion**: Telegram, RSS, Images, Voice Notes
- **AI Analysis**: Gemini 2.0 Flash for signal extraction and validation
- **Epistemic Engine**: Rigorous fact-checking with source hierarchy
- **Knowledge Graph**: Entity relationship extraction and visualization
- **Interactive Bot**: Deep activation buttons for instant analysis
- **Vector Search**: Semantic search via Cloudflare Vectorize

## Quick Start

```bash
# Install dependencies
npm install

# Development
npm run dev

# Typecheck
npm run typecheck

# Test
npm test

# Deploy
npm run deploy
```

## Documentation

- [Product Requirements](./docs/PRD.md)
- [Roadmap](./docs/ROADMAP.md)
- [Architecture & Design](./docs/ARCHITECTURE.md)
- [Technical Specs](./docs/specs/)

## Stack

- **Runtime**: Cloudflare Workers (Durable Objects)
- **AI**: Gemini 2.0 Flash
- **Storage**: SQLite (DO), Vectorize
- **Frontend**: React Dashboard
- **Tests**: Vitest

## License

Proprietary - Critical Insight © 2026
