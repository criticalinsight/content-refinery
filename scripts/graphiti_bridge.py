import asyncio
import json
import os
import httpx
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# Configuration
REFINERY_URL = "http://localhost:8787"
GRAPHITI_VENV_PYTHON = "/Users/brixelectronics/Documents/mac/criticalinsight_repos/gemini-graphiti-mcp/venv/bin/python"
GRAPHITI_MODULE = "graphiti_mcp.server"

async def sync_to_graphiti():
    print("--- Starting Graphiti Sync Bridge ---")
    
    # 1. Fetch unsynced items from ContentDO
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(f"{REFINERY_URL}/knowledge/sync")
            response.raise_for_status()
            data = response.json()
            items = data.get("items", [])
            if not items:
                print("No new items to sync.")
                return
            print(f"Found {len(items)} items to sync.")
        except Exception as e:
            print(f"Failed to fetch items from refinery: {e}")
            return

    # 2. Connect to Graphiti MCP
    server_params = StdioServerParameters(
        command=GRAPHITI_VENV_PYTHON,
        args=["-m", GRAPHITI_MODULE],
        env={**os.environ, "MCP_SERVER_NAME": "graphiti-mcp"}
    )

    synced_ids = []
    try:
        async with stdio_client(server_params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                print("Connected to Graphiti Knowledge Graph.")

                for item in items:
                    item_id = item["id"]
                    try:
                        # processed_json might be a string in SQLite
                        raw_json = item["processed_json"]
                        processed = json.loads(raw_json) if isinstance(raw_json, str) else raw_json
                        
                        # Extract the analysis (Gemini output)
                        analysis = processed.get("analysis", [])
                        if not isinstance(analysis, list):
                            analysis = [analysis]

                        for entry in analysis:
                            summary = entry.get("summary", "No summary")
                            relationships = entry.get("relationships", [])
                            
                            # Add the main fact
                            fact_content = f"MARKET SIGNAL: {summary}. Detail: {entry.get('detail', '')}"
                            await session.call_tool(
                                "mcp_graphiti-mcp_add_episode",
                                arguments={"content": fact_content, "group_id": "market_signals"}
                            )
                            
                            # Add specific relationships if available
                            for rel in relationships:
                                target = rel.get("target")
                                rel_type = rel.get("type")
                                desc = rel.get("description", "")
                                if target and rel_type:
                                    rel_fact = f"RELATIONSHIP: {summary} {rel_type} {target}. Context: {desc}"
                                    await session.call_tool(
                                        "mcp_graphiti-mcp_add_episode",
                                        arguments={"content": rel_fact, "group_id": "market_signals"}
                                    )
                        
                        synced_ids.append(item_id)
                        print(f"Successfully synced item {item_id}")
                    except Exception as e:
                        print(f"Error processing item {item_id}: {e}")

    except Exception as e:
        print(f"Graphiti MCP communication error: {e}")

    # 3. Mark items as synced in ContentDO
    if synced_ids:
        async with httpx.AsyncClient() as client:
            try:
                res = await client.post(f"{REFINERY_URL}/knowledge/mark-synced", json={"ids": synced_ids})
                res.raise_for_status()
                print(f"Marked {len(synced_ids)} items as synced in refinery.")
            except Exception as e:
                print(f"Failed to mark items as synced: {e}")

if __name__ == "__main__":
    asyncio.run(sync_to_graphiti())
