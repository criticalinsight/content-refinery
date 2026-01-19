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
