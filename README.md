# Content Refinery

**Telegram-First Market Intelligence Platform**

A Cloudflare Workers application that ingests financial news from multiple sources, applies AI-powered analysis, and outputs actionable market signals with source attribution.

## Features

- **Multi-Source Ingestion**: Telegram (Bot API), RSS, Webhook (Discord/Slack), Images, Voice Notes.
- **AI Analysis**: Gemini 2.5 Flash for structured signal extraction and causal validation.
- **Resource Optimization**:
  - **Elastic Heartbeat**: Exponential backoff doubling up to 1 hour when idle.
  - **Analysis Deduplication**: 24h content-hash cache for $LLM cost reduction.
  - **Granular Batch Extraction**: De-interleaving of multiple signals from batch inputs.
- **Predictive Alpha**: Graph-based conviction scoring and forward-looking market insights.
- **Dual-Channel Mirroring**: Automatic routing of High-Signal (Alpha) vs. Low-Signal (Beta) content.
- **Interactive Bot**: Deep activation buttons (`🔎 Fact Check`, `⚡ Synthesis`, `🧠 Deep Dive`).
- **Vector Search**: Semantic search via Cloudflare Vectorize.

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
- **AI**: Gemini 2.5 Flash
- **Storage**: SQLite (DO), Vectorize
- **Frontend**: React Dashboard
- **Tests**: Vitest

## License

Proprietary - Critical Insight © 2026
