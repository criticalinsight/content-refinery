# Content Refinery - Product Requirements Document

**Version**: 1.5  
**Last Updated**: 2026-01-19  
**Status**: Production (Live)

---

## Executive Summary

Content Refinery is an institutional-grade intelligence platform that ingests, processes, and distributes real-time signals from multiple sources. Built on Cloudflare's edge infrastructure, it provides sub-50ms latency signal processing with AI-powered analysis, semantic memory, and real-time streaming to connected clients.

### Production URLs
- **API**: [api.moecapital.com](https://api.moecapital.com)
- **Dashboard**: [app.moecapital.com](https://app.moecapital.com)

---

## Core Features (Implemented)

### 1. Live Telegram Ingestion
- **MTProto Authentication**: QR code login with 2FA support
- **Session Persistence**: Automatic session restoration on worker restart
- **Real-time Listener**: Captures messages from all connected channels
- **Auto-Registration**: Channels automatically added to tracking database

### 2. AI-Powered Signal Processing
- **Gemini Integration**: Uses `gemini-2.5-flash-preview-05-20` for analysis
- **Intelligent Extraction**: Summary, sentiment, urgency, relevance scoring
- **Entity Recognition**: Extracts tickers, companies, events
- **Deduplication**: Consolidates signals from multiple sources

### 3. Vectorize Semantic Memory
- **Embedding Storage**: 768-dimensional vectors for semantic search
- **Index**: `refinery_signals` with 10k+ capacity
- **Retrieval**: Context-aware signal matching for AI enhancement

### 4. Real-time Dashboard
- **WebSocket Streaming**: Live signal feed with <50ms latency
- **Premium UI**: Glassmorphism design with dark theme
- **Telegram Status**: Live connection indicator with login modal
- **Signal Cards**: Relevance bars, sentiment badges, urgency flags

### 5. Multi-Source Architecture
- **Telegram**: Live user channel ingestion (active)
- **API Ingest**: `/ingest` endpoint for external sources
- **RSS/Webhooks**: Extensible input handlers (planned)

---

## Technical Architecture

```
┌─────────────────────┐     ┌──────────────────────┐
│   Telegram MTProto  │────▶│  Content Refinery    │
│   (Live Messages)   │     │  Durable Object      │
└─────────────────────┘     │                      │
                            │  ┌────────────────┐  │
┌─────────────────────┐     │  │ SQLite Storage │  │
│   External APIs     │────▶│  │ (Channels,     │  │
│   (/ingest)         │     │  │  Signals, etc) │  │
└─────────────────────┘     │  └────────────────┘  │
                            │          │           │
                            │          ▼           │
                            │  ┌────────────────┐  │
                            │  │ Gemini AI      │  │
                            │  │ Processing     │  │
                            │  └────────────────┘  │
                            │          │           │
                            │          ▼           │
                            │  ┌────────────────┐  │
                            │  │ Vectorize      │  │
                            │  │ Memory Index   │  │
                            │  └────────────────┘  │
                            └──────────┬───────────┘
                                       │
                            ┌──────────▼───────────┐
                            │   WebSocket Clients  │
                            │   (Dashboard, etc)   │
                            └──────────────────────┘
```

---

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/ws` | WS | WebSocket signal stream |
| `/ingest` | POST | Manual signal ingestion |
| `/process` | POST | Trigger batch processing |
| `/stats` | GET | System statistics |
| `/telegram/auth/status` | GET | Telegram connection status |
| `/telegram/auth/qr-token` | GET | Generate QR code for login |
| `/telegram/auth/qr-check` | GET | Poll for QR scan completion |
| `/telegram/auth/qr-password` | POST | Submit 2FA password (QR flow) |
| `/telegram/auth/send-code` | POST | Send phone verification code |
| `/telegram/auth/sign-in` | POST | Complete phone login |
| `/telegram/auth/me` | GET | Get logged-in user info |

---

## User Personas

### Primary: Institutional Trader
- Needs real-time market intelligence
- Values low latency and signal quality
- Requires filtering by relevance/urgency

### Secondary: Research Analyst
- Needs historical signal search
- Values semantic retrieval capabilities
- Requires source attribution

---

## Success Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Signal Latency | <100ms | ~50ms |
| AI Processing Time | <2s | ~1.5s |
| Uptime | 99.9% | 99.9% |
| Active Channels | 10+ | 1 (Telegram) |

---

## Security & Compliance

- **End-to-End Encryption**: All WebSocket connections use WSS
- **CORS**: Configured for cross-origin dashboard access
- **Secrets Management**: API keys stored as Cloudflare secrets
- **Session Security**: Encrypted Telegram session storage

---

## Dependencies

| Service | Purpose | Status |
|---------|---------|--------|
| Cloudflare Workers | Edge compute | ✅ Active |
| Cloudflare Durable Objects | State management | ✅ Active |
| Cloudflare Vectorize | Semantic memory | ✅ Active |
| Cloudflare Pages | Dashboard hosting | ✅ Active |
| Telegram MTProto | Message ingestion | ✅ Active |
| Google Gemini | AI processing | ✅ Active |
