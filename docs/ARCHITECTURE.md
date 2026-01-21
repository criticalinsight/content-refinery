# Architecture: Content Refinery

The Content Refinery is designed as a **Data-Oriented**, **Telegram-First** intelligence system running on Cloudflare Workers and Durable Objects.

## Core Design Principles

1.  **Objective Simplicity**: Separation of orthogonal concerns (Routing, Persistence, Transport).
2.  **Data-Orientation**: Strict separation of Value (immutable `Signal` objects) from State (SQLite).
3.  **Decomplection**: Independent lifecycles for external services (MTProto) vs. internal logic.

## System Components

### 1. The Core Durable Object (`ContentDO`)
Acts as the **Orchestrator**. It initializes the environment and coordinates the specialized modules but delegates actual work.

### 2. API Router (`src/api/Router.ts`)
A stateless dispatcher that handles:
- HTTP Request/Response lifecycles.
- CORS handling.
- Basic routing logic (Signals, Health, Analytics).

### 3. Fact Store (`src/FactStore.ts`)
The data access layer managing SQLite interactions.
- Enforces strict TypeScript schemas (`Signal`, `Entity`).
- Treats data as "Facts" (immutable records of events).

### 4. Collectors (`src/collectors/`)
Specialized modules for external data ingestion.
- **TelegramCollector**: Manages the complex MTProto connection, session persistence, and message listening loops, decoupled from the main DO lifecycle.

## Data Flow

1.  **Ingest**: `TelegramCollector` receives a raw message -> Normalizes it.
2.  **Process**: `ContentDO` sends raw text to Gemini AI -> Returns `Signal` JSON.
3.  **Store**: `FactStore` saves the `Signal` to SQLite and logs the event.
4.  **Access**: `Router` handles `/signals` requests -> Queries `FactStore` -> Returns JSON.
