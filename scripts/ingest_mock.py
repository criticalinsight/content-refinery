import requests
import json
import uuid
import time

URL = "http://localhost:8787/ingest"

def ingest_mock(chat_id, title, text, source_type="telegram"):
    payload = {
        "chatId": chat_id,
        "title": title,
        "text": text,
        "metadata": {
            "source_type": source_type,
            "ingested_via": "mock_simulator"
        }
    }
    try:
        response = requests.post(URL, json=payload)
        print(f"[{source_type.upper()}] Ingested: {title} | Status: {response.status_code}")
        return response.json()
    except Exception as e:
        print(f"Failed to ingest: {e}")

if __name__ == "__main__":
    print("--- Starting Multi-Source Ingestion Simulator ---")
    
    # Telegram Mock
    ingest_mock("tg_123", "Whale Alert", "$BTC breakdown below 40k imminent. Selling pressure from Mt. Gox wallets confirmed.")
    
    # Twitter Mock
    ingest_mock("tw_finviz", "Finviz Insider", "URGENT: $AAPL supply chain issues in China reported by Nikkei. Expecting 5% downside.", source_type="twitter")
    
    # RSS Mock
    ingest_mock("rss_reuters", "Reuters Business", "Fed maintains interest rates, signals no cuts until late 2026. Bullish for USD.", source_type="rss")

    print("\n--- Ingestion Complete. Check /stats or /sql for results. ---")
