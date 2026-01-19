# Content Refinery - Product Requirements Document

## 1. Overview
The Content Refinery is an autonomous market intelligence engine that ingests high-volume text streams (Telegram, RSS, Webhooks), filters for "Alpha" (high-value signals), and synthesizes them into a Relational Knowledge Graph.

## 2. Core Pipelines

### A. Ingestion Layer
- **Telegram Userbot**: Connects via `gram.js` to ingest messages from subscribed channels.
- **RSS Feeds**: Polls user-configured RSS sources every 30 minutes.
- **Webhooks**: Accepts JSON payloads from Discord, Slack, and generic sources.
- **Media Processing**:
  - **Voice**: Transcribes audio notes via Cloudflare Workers AI (Whisper).
  - **Vision**: Extracts text/structure from images via Gemini 1.5 Flash Vision.

### B. Alpha Engine (Processing)
- **Scoring**: Uses Gemini 2.0 Flash to score content relevance (0-100).
- **Scope Filters**: Strict whitelist for Global Macro, Corporate News, Stock/Crypto Pitches, and Prediction Markets.
- **Channel Hygiene**: Automatically tracks and prunes sources with >100 consecutive irrelevant messages.
- **Analyst Persona**: "Senior Equity Analyst" capable of:
  - **Forensic Fact-Checking**: Validating material claims.
  - **Epistemic Analysis**: Identifying logical fallacies and variant perceptions.
  - **Elevator Pitch Generation**: Creating high-conviction summaries.
- **Signal Extraction**:
  - **Relevance > 40**: Indexed as a "Signal".
  - **Relevance > 80**: Mirrored to "High Signal Alpha" channel.
- **Entity Extraction**: Identifies Tickers (`$BTC`), People (`Elon Musk`), and Concepts (`Tariffs`).
- **Triple Extraction**: Maps relationships (`Subject -> Predicate -> Object`) for the Knowledge Graph.

### C. Knowledge Graph
- **Storage**: SQLite D1 Database (`graph_nodes`, `graph_edges`).
- **Visualization**: Force-directed graph in the Dashboard.
- **Narratives**: Clustering signals into coherent market storylines.

## 3. Interfaces
- **Admin Dashboard**: React + Vite app for visualization and configuration.
- **API**: Cloudflare Worker exposing REST endpoints for signals and graph data.
- **Telegram Bot**: Interaction for status checks (`/status`) and manual ingest.

## 4. Master Prompt for Regeneration
*Use this prompt to instruct an AI to regenerate the core logic of this application.*

> **Role**: Senior Full-Stack Engineer & AI Architect.
> **Objective**: Build "Content Refinery", an autonomous market intelligence engine on Cloudflare Workers.
>
> **Tech Stack**:
> - **Runtime**: Cloudflare Workers (TypeScript) + Durable Objects (State).
> - **Database**: D1 (SQLite) for relation data + Vectorize for semantic search.
> - **Ingestion**: Gram.js (Telegram), RSS Polling, Webhooks.
> - **AI Model**: Gemini 2.0 Flash (via Google AI Studio API).
> - **Frontend**: React + Vite (Dashboard) with internal API.
>
> **Core Architecture**:
> 1. **ContentDO Class**: Main Durable Object for orchestration.
>    - `pollRSSFeeds()`: Cron-based fetcher.
>    - `processBatch()`: Sends text to Gemini for analysis.
>    - `analyzeSourceBatch()`: Uses "Senior Equity Analyst" persona.
> 2. **Analyst Persona (Prompt)**:
>    - Role: Forensic Fact-Checker & Portfolio Manager.
>    - Tasks: Fact-Check, Epistemic Analysis, 10-Sentence Pitch.
>    - Output: JSON `{ summary, fact_check, analysis, relevance_score, is_urgent, sentiment, tickers, tags, triples }`.
> 3. **Smart Filters**:
>    - Strict Scope: Macro, Corporate, Crypto, Pitch, Prediction.
>    - Hygiene: Auto-ignore channels with >100 irrelevant msgs.
>    - Mirroring: Forward Score > 80 signals to Telegram channel.
> 4. **Knowledge Graph**:
>    - Extract `{subject, predicate, object}`.
>    - Store in D1 `graph_nodes` (with importance/velocity) and `graph_edges`.
>    - Visualize via `/knowledge/graph` endpoint (CORS enabled).
>
> **Deliverables**:
> - `src/ContentDO.ts`: Complete implementation of the above logic.
> - `wrangler.toml`: Config with cron triggers and bindings.
> - `worker.ts`: Entry point routing to Durable Object.

## 5. Technical Learnings
*Insights gained during development.*

1.  **CORS & Local Development**: Cloudflare Workers require explicit `Access-Control-Allow-Origin` headers for local Dashboards (localhost) to consume APIs. Middleware functions like `addCors(response)` are essential.
2.  **AI JSON Reliability**: Gemini 2.0 Flash is highly capable but requires strict JSON schema in the prompt to reliably output arrays of objects (e.g., `triples` for the Knowledge Graph).
3.  **Gram.js in Serverless**: Running a stateful Telegram client (Gram.js) in a serverless environment (Workers) requires Durable Objects to maintain the session string and connection state to avoid banning.
4.  **Auto-Pruning is Vital**: High-volume ingestion (Telegram) quickly fills quotas with noise. Implementing an "Auto-Ignore" threshold (e.g., 100 irrelevant messages) saves significant costs and tokens.
5.  **Graph Visualization**: Force-directed graphs require carefully mapped node/link data. The backend must flatten compressed AI output (e.g., `s,p,o`) into full objects (`source, target, value`) for frontend libraries like `react-force-graph`.
