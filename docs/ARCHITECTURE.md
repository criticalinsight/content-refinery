# Architecture: Content Refinery

The Content Refinery is designed as a **Data-Oriented**, **Telegram-First** intelligence system running on Cloudflare Workers and Durable Objects.

## Core Design Principles

1. **Objective Simplicity**: Separation of orthogonal concerns (Routing, Persistence, Transport).
2. **Data-Orientation**: Strict separation of Value (immutable `Signal` objects) from State (SQLite).
3. **Stateless Transport**: Direct Telegram Bot API integration via webhooks, removing MTProto lifecycle complexity.

## System Components

### 1. The Core Durable Object (`ContentDO`)

Acts as the **Orchestrator**. It initializes the environment and coordinates the specialized modules but delegates actual work.

### 2. API Services (`src/api/`)

Stateless dispatchers categorized by concern:

- **Router**: Master dispatcher for public requests (Durable Object entry point).
- **AdminService**: Handles privileged operations like `/admin/reprocess-last` and historical recovery.
- **SignalService**: High-performance retrieval for the dashboard and raw content inspection.
- **PredictiveService**: Exposes agentic foresight and conviction scoring derived from the graph.
- **KnowledgeService**: Manages triple-extraction and graph-based entity lookups.

### 3. Fact Store (`src/FactStore.ts`)

The data access layer managing SQLite interactions.

- Enforces strict TypeScript schemas (`Signal`, `Entity`).
- Treats data as "Facts" (immutable records of market events).
- Centralizes query logic to prevent SQL leakage into orchestrator components.

### 4. Collectors (`src/collectors/`)

Specialized modules for external data ingestion.

- **TelegramCollector**: Stateless interface for the Telegram Bot API. Manages webhooks, outbound messages, and media downloads via file IDs.
- **RSSCollector**: Handles scheduled polling and rate limiting for multi-source news feeds (e.g., Nitter, Finance blogs).
- **WebhookCollector**: Normalizes payloads from Discord, Slack, and generic webhooks into the standard pipeline.

### 5. Orchestration & Predictive Engine (`src/logic/`)

The system's "Brain":

- **Orchestrator**: Coordinates ingestion, deduplication, and routing. Handles forced vs. background analysis (PDFs/Images).
- **PredictiveEngine**: Analyzes graph topology and historical sentiment to generate forward-looking conviction scores.
- **Engine**: The AI prompt repository and Gemini interaction layer.

## Orchestration Loop (Dynamic Heartbeat)

The heartbeat of the system is the `Orchestrator.tick()` method, which uses an **Elastic Heartbeat (Exponential Backoff)**.

- **Active State**: Polls/Ticks every 5 minutes.
- **Idle State**: Backs off exponentially doubling up to 1 hour frequency.
- **Reactive**: Resets to 5-minute frequency immediately upon new content ingestion.
- **RSS Polling**: Checks feeds for new content.
- **Janitor**: Cleans up old logs and ephemeral data (<7 days).
- **Batch Synthesis**: Periodic generation of "Financial Digests" using Gemini 2.5 Flash.
- **Predictive Cycle**: Evaluates entities for high-conviction alpha mirroring.

## Automation Workflows (`.agent/`)

The project includes automated agent workflows for standardized operations:

- **Setup**: `workflows/setup.md` - Builds binary, resets state, starts supervisor.
- **Deploy**: `workflows/deploy.md` - Runs typechecks and deploys to Cloudflare with injected credentials.
- **Test**: `workflows/test.md` - Runs the full vitest suite with coverage reporting.

## Component Analysis (Complexity vs. Utility)

### Tier 1: Core Intelligence (High Utility / High Complexity)

* **`Orchestrator`**: The central nervous system. Coordinates ingestion, analysis, and output. It decides *what* to do with data.
- **`ContentDO`**: The host organism. Manages the Durable Object lifecycle, state migration, and external triggers (Cron, HTTP).
- **`TelegramCollector`**: The primary sensor. Handles complex MTProto state, session management, and realtime event loops.

### Tier 2: Operational Backbone (High Utility / Moderate Complexity)

* **`FactStore`**: The memory. Provides aclean, type-safe abstraction over SQLite schema and query logic.
- **`Router`**: The nervous system. Dispatches incoming HTTP requests to the appropriate service (`SignalService`, `AdminService`).
- **`PredictiveEngine`**: The intuition. Generates forward-looking signals and conviction scores based on graph topology.

### Tier 3: Support Services (Moderate Utility / Low Complexity)

* **`RSSCollector`**: Simple polling mechanism for standard feeds.
- **`WebhookCollector`**: Normalizes diverse payloads (Discord, Slack) into standard text.
- **`ErrorLogger`**: Diagnostics and structured logging to SQLite.

## Ingestion & Delivery Workflows

### 1. 🐦 Tweets & Batch Workflow

*Optimized for synthesis and trend detection.*

1. **Poll**: `RSSCollector` fetches data from bridges (Nitter/RSS).
2. **Store Raw**: Items saved to SQLite with content hashing for deduplication.
3. **Financial Digest (Cron)**:
    - Runs every 5 minutes.
    - Selects recent (<24h) unprocessed items.
    - Batch synthesis via **Gemini 2.5 Flash**.
4. **Mirroring**:
    - **High Signal Alpha**: Scores ≥ 80 or 75% forwarded to Alpha Channel.
    - **Low Signal Beta**: Scores 60-79% forwarded to Beta Channel (if configured).

### 2. 📄 Document & Pulse Workflow (Telegram)

*Optimized for immediate deep activation.*

1. **Ingest**: `worker.ts` routes `/telegram-webhook` POST requests to `ContentDO`.
2. **Stateless Processing**: `TelegramCollector` parses the Bot API update.
3. **Analysis Deduplication**:
    - Generates SHA-256 `content_hash`.
    - `FactStore` checks for recent (<24h) identical analysis.
    - Reuses cached `processed_json` if available, saving $LLM costs.
4. **Actionable Buttons**:
    - Signals in Telegram include interactive buttons for `Fact Check`, `Synthesis`, and `Deep Dive`.

### 3. 🔮 Predictive Alpha Workflow

1. **Graph Analysis**: `PredictiveEngine` scans the knowledge graph for high-weight entity clusters.
2. **Conviction Scoring**: Generates prediction objects with confidence intervals.
3. **Forecasting**: High-conviction predictions (>70%) are mirrored with unique "Predictive Alpha" formatting.
