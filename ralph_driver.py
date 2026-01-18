import os
import subprocess
import time
import sys
import asyncio
import json

# Try to import MCP (only works if installed in venv)
try:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    MCP_AVAILABLE = True
except ImportError:
    MCP_AVAILABLE = False
    print("Warning: 'mcp' library not found. Graphiti integration disabled.")

# Ensure sys.stdin is not used in background
sys.stdin = open(os.devnull, 'r')

# Configuration
PRIMARY_MODEL = "gemini-1.5-pro-latest" # Using standard llm-gemini names
FALLBACK_MODEL = "gemini-1.5-flash-latest"
VENV_BIN = "./.ralph_venv/bin"
LLM_PATH = f"{VENV_BIN}/llm"
TASKS_FILE = "TASKS.md"

def run_command(command, check=True):
    try:
        result = subprocess.run(command, shell=True, capture_output=True, text=True, check=check)
        return result.stdout, result.stderr, result.returncode
    except subprocess.CalledProcessError as e:
        return e.stdout, e.stderr, e.returncode

def call_llm(prompt, model=PRIMARY_MODEL):
    # Escape double quotes in prompt for shell safety
    safe_prompt = prompt.replace('"', '\\"').replace("'", "'\\''")
    command = f'{LLM_PATH} -m {model} "{safe_prompt}"'
    
    stdout, stderr, code = run_command(command, check=False)
    if code != 0:
        if "429" in stderr or "RESOURCE_EXHAUSTED" in stderr:
            print(f"Rate limit hit (429) for model {model}.")
            return "429", stderr
        return None, stderr
    return stdout, None

def main():
    print(f"--- Ralph Driver Iteration: {time.ctime()} ---")
    
    if not os.path.exists(TASKS_FILE):
        print(f"Error: {TASKS_FILE} not found.")
        return

    # Check for active task
    with open(TASKS_FILE, 'r') as f:
        tasks = f.read()
    
    # Simple check for the first unchecked box
    if "- [ ]" not in tasks:
        print("No active tasks found in TASKS.md.")
        return

    # Gather context: File tree
    file_tree, _, _ = run_command("ls -R | grep -v node_modules | grep -v .git | grep -v .ralph_venv | head -n 50")
    
    # Construct a robust prompt
    prompt = f"""You are Ralph, an autonomous senior developer.
Current Tasks:
{tasks}

Environment Context (File Tree Snippet):
{file_tree}

Goal: Identify the next single, low-risk technical step to move the project forward based on the tasks in TASKS.md.
Requirement: Provide ONLY the raw shell command to execute. No explanations, no markdown blocks.
"""
    
    output, error = call_llm(prompt, model=PRIMARY_MODEL)
    
    if output == "429":
        print("Primary model hit rate limit. Signaling 1-hour sleep.")
        sys.exit(42)  # Special exit code for 429
        
    if not output or not output.strip():
        print(f"Error calling primary model ({PRIMARY_MODEL}): {error}")
        print(f"Attempting fallback to {FALLBACK_MODEL}...")
        output, error = call_llm(prompt, model=FALLBACK_MODEL)
        
    if output == "429":
        print("Fallback model also hit rate limit. Signaling 1-hour sleep.")
        sys.exit(42)

    if not output or not output.strip():
        print(f"Fallback failed: {error}")
        return

    # Basic cleaning of output
    command = output.strip().split('\n')[0].strip('`').strip()
    if not command:
        print("LLM returned an empty command.")
        return

    print(f"Executing: {command}")
    
    # Execute the command
    out, err, code = run_command(command, check=False)
    if out:
        print(f"STDOUT:\n{out}")
    if err:
        print(f"STDERR:\n{err}")

    print(f"Iteration complete with exit code {code}.")

if __name__ == "__main__":
    main()
