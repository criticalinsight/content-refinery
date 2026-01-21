import requests
import json
import time

API_URL = "https://api.moecapital.com"

# 1. Find the PDFs
query = {
    "sql": "SELECT id, source_name, created_at FROM content_items WHERE raw_text LIKE '%[PDF DOCUMENT]%' ORDER BY created_at DESC LIMIT 10"
}

try:
    print("Finding PDFs...")
    response = requests.post(f"{API_URL}/sql", json=query)
    response.raise_for_status()
    items = response.json().get('result', [])
    
    if not items:
        print("No PDFs found to reprocess.")
        exit()

    pdf_ids = [item['id'] for item in items]
    print(f"Found {len(pdf_ids)} PDFs to reprocess:")
    for item in items:
        print(f"- {item['source_name']} (ID: {item['id']})")

    # 2. Trigger Reprocessing
    print("\nTriggering reprocessing...")
    payload = {"sourceIds": pdf_ids}
    
    # Note: Depending on timeout limits of Cloudflare, processing multiple large PDFs might time out. 
    # But ContentDO handles specific list processing.
    digest_response = requests.post(f"{API_URL}/admin/digest", json=payload)
    
    if digest_response.status_code == 200:
        print("Reprocessing started successfully.")
        print(json.dumps(digest_response.json(), indent=2))
    else:
        print(f"Reprocessing failed: {digest_response.text}")

except Exception as e:
    print(f"Error: {e}")
