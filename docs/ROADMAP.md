# Strategic Roadmap: Content Refinery

This roadmap outlines the evolution of the Content Refinery from a basic financial signal extractor to a multi-source, high-fidelity intelligence hub.

---

## Phase 1: Foundation & Reliability (Current)
*Focus: Stabilizing the core ingestion and extraction pipeline.*

- [x] **Separate Repository**: Decouple refinery logic from the main application.
- [x] **Durable Object Integration**: Use DO SQLite for persistent ingestion tracking.
- [ ] **Advanced Prompt Engineering**: Refine the News Analyst prompt for higher precision and lower latency.
- [ ] **Comprehensive Error Handling**: Implement robust retries and DLQs (Dead Letter Queues) for failed Gemini processing.

## Phase 2: Multi-Source Expansion
*Focus: Broadening the data stream and improving context.*

- [ ] **Twitter/X Integration**: Ingest real-time market sentiment from social media.
- [ ] **RSS & News Feed Aggregation**: Layer in official institutional news sources.
- [ ] **Source Weighting**: Implement a reputation system to weight signals based on source historical accuracy.
- [ ] **Multimodal Processing**: Process images and charts from Telegram/Twitter using Gemini's vision capabilities.

## Phase 3: Relational Intelligence
*Focus: Connecting the dots between signals.*

- [ ] **Knowledge Graph Integration (Graphiti)**: Store entities and relationships to detect cross-asset impacts.
- [ ] **Temporal Correlation**: Identify patterns where Signal A consistently leads to Event B.
- [ ] **Impact Forecasting**: Move from "what happened" to "what is likely to happen next" based on relational context.

## Phase 4: Enterprise Scale & Privacy
*Focus: Performance, security, and institutional features.*

- [ ] **Vector Database Integration**: Long-term semantic search over years of refined data.
- [ ] **Encrypted Signal Routing**: End-to-end encryption for high-alpha private feeds.
- [ ] **Real-time API Access**: Expose refined signals via a low-latency websocket API for external consumption.

---

## Technical Milestones

| Milestone | Target Date | Primary Tech |
| :--- | :--- | :--- |
| **v1.0: Signal Core** | Q1 2026 | Cloudflare DO + Gemini 2.0 |
| **v1.5: Multi-Source** | Q2 2026 | Social API + Multimodal Vision |
| **v2.0: Neural Graph** | Q3 2026 | Graphiti + Relation Mapping |
| **v3.0: Alpha Engine** | Q4 2026 | Predictive ML + Vector Memory |
