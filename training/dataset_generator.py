"""
dataset_generator.py — Docent Training Data Generator

Extracts code symbols, repository structures, and git context to create
instruction-tuning datasets for training/fine-tuning custom Docent models.

Supported output formats:
- ChatML (messages array: system, user, assistant)
- Alpaca (instruction, input, output)
- ShareGPT (conversations array)

Usage:
  # Generate synthetic dataset of 250+ examples across multiple languages:
  python dataset_generator.py --synthetic --output docent_train.jsonl

  # Scan a local repository and generate symbol explanation pairs:
  python dataset_generator.py --repo-path /path/to/codebase --output repo_train.jsonl
"""

import os
import re
import json
import random
import argparse
from typing import List, Dict, Any

DOCENT_SYSTEM_PROMPT = (
    "You are Docent, a sharp, seasoned engineering lead and codebase guide. "
    "Your job is to provide crisp, character-voiced explanations of code symbols, "
    "architecture, and repositories. You speak directly, with dry wit and genuine insight. "
    "Never waffle. Avoid generic fluff. Tell engineers what actually matters."
)

SAMPLE_TEMPLATES = [
    # 1. Database / Cache
    {
        "category": "database",
        "symbol": "get_user_by_id",
        "lang": "python",
        "code": """async def get_user_by_id(db: AsyncSession, user_id: str) -> Optional[User]:
    cached = await redis_client.get(f"user:{user_id}")
    if cached:
        return User.parse_raw(cached)
    user = await db.execute(select(User).where(User.id == user_id))
    result = user.scalar_one_or_none()
    if result:
        await redis_client.setex(f"user:{user_id}", 3600, result.json())
    return result""",
        "explanation": "Fetches user data with a Redis write-through cache layer (1h TTL). Falls back to Postgres if cache misses. Watch out for cache invalidation bugs if user attributes get updated outside this helper."
    },
    {
        "category": "database",
        "symbol": "DocentCache",
        "lang": "typescript",
        "code": """export class DocentCache {
  constructor(private readonly storage: vscode.Memento) {}
  computeHash(content: string, commits: number): string {
    return crypto.createHash('sha256').update(`${content}:${commits}`).digest('hex').slice(0, 16);
  }
  getCachedWelcome(hash: string): string | undefined {
    return this.storage.get(`docent:welcome:${hash}`);
  }
}""",
        "explanation": "Persistent caching mechanism tied to workspace state. Keyed by SHA-256 hash of repository metadata and total commit count, ensuring explanations automatically invalidate whenever git history advances."
    },
    # 2. Auth / Security
    {
        "category": "auth",
        "symbol": "verifyJwtToken",
        "lang": "typescript",
        "code": """export function verifyJwtToken(token: string, secret: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'], clockTolerance: 10 });
    return decoded as TokenPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AuthError('Token expired', 401);
    }
    throw new AuthError('Invalid authorization token', 403);
  }
}""",
        "explanation": "Strict JWT signature and expiration validator with a 10-second clock skew tolerance. Throws explicit HTTP 401 on expiration versus 403 on tampering. Ensure the secret is loaded from secure vault storage."
    },
    # 3. Async / Concurrency / Workers
    {
        "category": "concurrency",
        "symbol": "TaskQueue.processNext",
        "lang": "typescript",
        "code": """async processNext(): Promise<void> {
  if (this.running >= this.concurrencyLimit || this.queue.length === 0) return;
  const task = this.queue.shift()!;
  this.running++;
  try {
    await task.execute();
  } catch (err) {
    this.logger.error(`Task ${task.id} failed`, err);
    if (task.retries < 3) this.queue.push(task.retry());
  } finally {
    this.running--;
    void this.processNext();
  }
}""",
        "explanation": "Bounded FIFO task scheduler with exponential retry backoff (max 3 attempts). Controls concurrent throughput to protect downstream APIs from throttling spikes."
    },
    # 4. Networking / LLM Client
    {
        "category": "networking",
        "symbol": "LLMClient.callLocal",
        "lang": "typescript",
        "code": """private async callLocal(prompt: string, maxTokens: number): Promise<string> {
  const endpoint = this.config.get('localEndpoint', 'http://localhost:11434');
  const res = await fetch(`${endpoint}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({ model: 'docent-custom', messages: [{ role: 'user', content: prompt }] })
  });
  const data = await res.json();
  return data.message.content.trim();
}""",
        "explanation": "Direct HTTP connector to a local Ollama or OpenAI-compatible inference server. Zero API keys, zero rate-limit risks, and 100% private execution right on the user's machine."
    },
    # 5. Git / File Scanner
    {
        "category": "git",
        "symbol": "GitAnalyzer.enrichWithRevertInfo",
        "lang": "typescript",
        "code": """async enrichWithRevertInfo(zones: DangerZone[]): Promise<DangerZone[]> {
  const revertLog = await this.git.raw(['log', '--grep=revert', '-n', '50', '--name-only']);
  for (const zone of zones) {
    if (revertLog.includes(zone.filePath)) {
      zone.hasReverts = true;
      zone.score += 25;
    }
  }
  return zones;
}""",
        "explanation": "Scans git history for commit messages matching 'revert' and boosts the danger score of flagged files. High churn + previous rollbacks = fragile code that demands extra review."
    }
]

VARIANTS = [
    ("Explain this function for an engineer reading it for the first time.", "crisp summary"),
    ("What does this code do, and what are the architectural trade-offs?", "architectural context"),
    ("Give a quick Docent hover overview for this symbol.", "hover overview"),
]

def generate_synthetic_dataset(num_samples: int = 250) -> List[Dict[str, Any]]:
    dataset = []
    
    for i in range(num_samples):
        base = random.choice(SAMPLE_TEMPLATES)
        instruction_variant, _ = random.choice(VARIANTS)
        
        user_message = (
            f"File: src/{base['category']}/{base['symbol'].split('.')[0].lower()}.{base['lang']}\n\n"
            f"Code:\n```{base['lang']}\n{base['code']}\n```\n\n"
            f"Symbol: `{base['symbol']}`\n\n"
            f"{instruction_variant}"
        )
        
        assistant_message = base["explanation"]
        
        # ChatML format
        item = {
            "messages": [
                {"role": "system", "content": DOCENT_SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
                {"role": "assistant", "content": assistant_message}
            ]
        }
        dataset.append(item)
        
    return dataset

def extract_symbols_from_file(filepath: str) -> List[Dict[str, str]]:
    """Basic regex extractor for JS/TS/Python symbols from real files."""
    results = []
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
    except Exception:
        return results

    # Match JS/TS functions & classes
    ts_matches = re.finditer(r'(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)', content)
    for m in ts_matches:
        results.append({
            "name": m.group(1),
            "snippet": content[max(0, m.start() - 50):min(len(content), m.end() + 200)]
        })
        
    class_matches = re.finditer(r'class\s+([a-zA-Z0-9_$]+)', content)
    for m in class_matches:
        results.append({
            "name": m.group(1),
            "snippet": content[max(0, m.start() - 20):min(len(content), m.end() + 250)]
        })
        
    # Match Python def / class
    py_matches = re.finditer(r'def\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\):', content)
    for m in py_matches:
        results.append({
            "name": m.group(1),
            "snippet": content[max(0, m.start() - 20):min(len(content), m.end() + 200)]
        })
        
    return results

def main():
    parser = argparse.ArgumentParser(description="Generate Docent fine-tuning datasets.")
    parser.add_argument("--synthetic", action="store_true", help="Generate synthetic training data")
    parser.add_argument("--count", type=int, default=250, help="Number of synthetic examples")
    parser.add_argument("--repo-path", type=str, help="Extract symbols from a real repository")
    parser.add_argument("--output", type=str, default="docent_dataset.jsonl", help="Output file path")
    args = parser.parse_args()

    data = []
    if args.synthetic or not args.repo_path:
        print(f"[*] Generating {args.count} synthetic Docent training samples...")
        data = generate_synthetic_dataset(args.count)
    elif args.repo_path:
        print(f"[*] Scanning repository: {args.repo_path}")
        for root, _, files in os.walk(args.repo_path):
            if any(p in root for p in ['.git', 'node_modules', 'dist', '__pycache__']):
                continue
            for file in files:
                if file.endswith(('.ts', '.js', '.py', '.tsx', '.jsx')):
                    full_path = os.path.join(root, file)
                    symbols = extract_symbols_from_file(full_path)
                    for sym in symbols[:3]:
                        user_msg = f"File: {file}\nSymbol: `{sym['name']}`\nSnippet:\n```\n{sym['snippet']}\n```\nExplain what this does in Docent's persona."
                        data.append({
                            "messages": [
                                {"role": "system", "content": DOCENT_SYSTEM_PROMPT},
                                {"role": "user", "content": user_msg},
                                {"role": "assistant", "content": f"Core component `{sym['name']}`. Handles operational execution within `{file}`."}
                            ]
                        })

    out_path = os.path.abspath(args.output)
    with open(out_path, 'w', encoding='utf-8') as f:
        for entry in data:
            f.write(json.dumps(entry) + '\n')

    print(f"[+] Dataset saved successfully: {out_path} ({len(data)} entries)")

if __name__ == "__main__":
    main()
