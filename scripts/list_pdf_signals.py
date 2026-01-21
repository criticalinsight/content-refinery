import requests
import json
import datetime

API_URL = "https://api.moecapital.com/sql"

def get_pdf_signals():
    query = {
        "sql": """
            SELECT created_at, processed_json 
            FROM content_items 
            WHERE raw_text LIKE '%[PDF DOCUMENT]%' 
              AND processed_json LIKE '%relevance_score%' 
            ORDER BY created_at DESC 
            LIMIT 10
        """
    }
    
    try:
        response = requests.post(API_URL, json=query)
        response.raise_for_status()
        data = response.json()
        
        results = data.get('result', [])
        print(f"Found {len(results)} PDF entries (Chunks/docs processed):\n")
        
        # Group by created_at (proxy for source calc) to verify density
        grouped = {}
        for item in results:
            ts = item.get('created_at')
            if ts not in grouped:
                grouped[ts] = []
            
            try:
                processed = json.loads(item.get('processed_json'))
                analysis_list = processed.get('analysis', [])
                # Handle possible nested list from previous logic or current logic
                if isinstance(analysis_list, list):
                   grouped[ts].extend(analysis_list)
            except:
                pass

        for ts, signals in grouped.items():
            dt = datetime.datetime.fromtimestamp(ts / 1000).strftime('%Y-%m-%d %H:%M:%S')
            print(f"=== Document processed at {dt} ===")
            print(f"Total Signals: {len(signals)}")
            
            for signal in signals[:5]: # Show first 5 previews
                if isinstance(signal, dict):
                    print(f"  - [{signal.get('relevance_score')}] {signal.get('summary', '')[:100]}...")
            if len(signals) > 5:
                print(f"  ... and {len(signals) - 5} more.")
            print("\n")


    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    get_pdf_signals()
