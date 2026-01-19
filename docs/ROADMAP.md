# Content Refinery - Telegram Roadmap

**Current Version:** 2.0 (Autonomous Agent)  
**Vision:** Telegram-First Market Intelligence  
**Last Updated:** 2026-01-19

---

## 🚀 Phase 16: Deep Telegram Integration
*Objective: Make Telegram the primary command center for the Refinery.*

1. [ ] **Slash Commands Engine**: Implement a robust command router for `@RefineryBot`.
    - `/status`: Show worker health, queue depth, and uptimes.
    - `/add <url> <category>`: Quick-add RSS feeds or channels.
    - `/ignore <id>`: Mute specific sources directly from the feed.
2. [ ] **Daily Briefing Agent**: Scheduled cron job to generate AM/PM summaries.
    - Sends a 'Morning Alpha' digest to the user's DM at 8:00 AM.
    - Includes 'Top 5 Narratives' and 'Market Sentiment'.
3. [ ] **Signal Mirroring (Userbot)**:
    - Auto-forward signals with `score > 8.0` to a private 'Saved Messages' topic.
    - Allows the user to receive push alerts only for 'God Tier' alpha.
4. [ ] **Inline Query Mode**:
    - Type `@RefineryBot $BTC` in any chat to get a popup list of recent signals.
    - Tap to send a formatted signal card to that chat.
5. [ ] **Telegram Mini-App**:
    - Updates `manifest.json` to support Telegram Web App launch.
    - optimize Dashboard UI to run inside the Telegram ephemeral browser.
6. [ ] **Voice-to-Alpha**:
    - User sends a voice note to the bot -> Audio transcribed -> Added as a 'Human Signal' to the graph.
7. [ ] **Admin Alerts**:
    - Forward `ErrorLogger` critical failures directly to the Admin DM.

---

## 🔮 Future Phases
*To be defined after Telegram integration is complete.*
