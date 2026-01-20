# Content Refinery - Telegram Roadmap

**Current Version:** 2.1 (Epistemic Engine)  
**Vision:** Telegram-First Market Intelligence  
**Last Updated:** 2026-01-20

---

## 🚀 Phase 16: Deep Telegram Integration ✅
*Objective: Make Telegram the primary command center for the Refinery.*

2. [x] **Daily Briefing Agent**: Scheduled cron job to generate AM/PM summaries sent to https://t.me/highsignalalpha (ID: -1003589267081).
    - Sends a 'Alpha' digest to the user's DM at 5:00 AM and 5PM.
    - Includes 'Top 5 Narratives' and 'Market Sentiment'.
3. [x] **Signal Mirroring (Userbot)**:
    - Auto-forward signals with `score > 8.0` to  https://t.me/highsignalalpha (ID: -1003589267081).
    - Allows the user to receive push alerts only for 'God Tier' alpha.
7. [x] **Admin Alerts**:
    - Forward `ErrorLogger` critical failures directly to the Admin DM.
8. [x] **Voice-to-Alpha**:
    - Automatically transcribe voice notes and ingest as market signals.
9. [x] **Omni-Alpha (Gemini OCR)**:
    - Automatically analyze photos and screenshots for market intelligence.

---

## 🧠 Phase 17: Knowledge & Visualization ✅
*Objective: Turn raw signals into a structured Knowledge Graph and visualize it.*

1. [x] **Relational Knowledge Graph**:
    - Extract Subject-Predicate-Object triples (`Bitcoin -> price -> tumbles`).
    - Stored in SQLite for persistent graph queries.
2. [x] **Signal Dashboard**:
    - React-based dashboard for real-time signal monitoring.
    - 2D Force-Directed Graph visualization of entities.
3. [x] **Backfill & Historical Processing**:
    - Ability to ingest historical Telegram messages for context.
    - `/admin/backfill` endpoint implemented.
4. [x] **Epistemic Analyst Prompt**:
    - **Forensic Fact-Checking**: Verifies claims against trusted sources.
    - **Epistemic Analysis**: Validates logical soundness and identifies biases.
    - **High-Conviction Pitch**: Synthesizes insights into a 10-sentence elevator pitch.
5. [x] **Interactive Deep Activation (Bot)**:
    - **Buttons**: Fact Check, Synthesis, Deep Dive, Graph attached to every signal.
    - **Callback Handling**: Instant routing to detailed Epistemic prompts.
6. [x] **Smart Filtering & Auto-Pruning**:
    - **Strict Scope**: Filters for Macro, Corporate, Crypto, Pitches, and Prediction Markets.
    - **Channel Hygiene**: Automatically ignores channels with >100 consecutive irrelevant messages.
7. [x] **Comprehensive Testing**:
    - 18 unit tests passing (Vitest).
    - Coverage: Core Logic, Epistemic Engine, RSS Parsing, Error Logging.

---

## 🔮 Phase 18: Predictive Alpha (Next)
*Objective: Scoring and ranking assets based on graph centrality and sentiment.*

1. [ ] **Centrality Scoring**:
    - PageRank/Eigenvector centrality on Knowledge Graph.
    - Identify most-connected entities.
2. [ ] **Sentiment Aggregation**:
    - Aggregate signal sentiments per ticker/entity over time.
    - Detect sentiment shifts and momentum.
3. [ ] **Predictive Signals**:
    - Generate "Conviction Scores" based on graph + sentiment.
    - Alert on significant momentum changes.
4. [ ] **Backtesting Framework**:
    - Historical signal accuracy tracking.
    - Performance reports for analyst predictions.

