# Docent 🏛️

> **A friendly, character-voiced guide to any codebase — automatically generated from the code itself.**

Orienting yourself in an unfamiliar repository usually takes hours of clicking around or finding a senior engineer to give you a tour. Unlike tools like CodeTour or Swimm that require someone to hand-author walkthroughs, **Docent generates its explanations automatically from the code itself**, dynamically updating as the repository evolves.

---

## ✨ Features

- 🎩 **Museum-Guide Persona**: Knowledgeable, warm, slightly dry, and never condescending. Think *"helpful senior dev who's shown five people around this codebase and has a few good lines about it."*
- 🤖 **100% Local & Custom Model Support**: Run completely offline and privately using Ollama or your own fine-tuned models (`docent-custom`, `qwen2.5-coder`, `llama3.2`). **Zero API keys, zero rate-limit/billing failures, and zero cloud costs.**
- 🧠 **Complete Custom Training Pipeline**: Includes a turnkey dataset generator (`training/dataset_generator.py`), 4-bit QLoRA fine-tuner (`training/fine_tune.py`), and Ollama `Modelfile` to build your own bespoke model.
- ⚡ **Zero-Config Static Fallback**: Always functional. Analyzes manifests, directory layouts, and Git history natively even when models are offline.
- ⚠️ **Git Danger Zone Radar**: Flags high-churn hotspots (top-decile commit frequencies) and files with historical reverts, giving you a heads-up on tricky areas before you edit.
- 💡 **Contextual Hover Explanations**: Hover over any function or class declaration across TypeScript, JavaScript, Python, or JSX to see what it does and why it exists.
- 🔒 **Privacy-First & Secure**: No code leaves your machine when using local models or static analysis. API keys for cloud providers are stored in VS Code's OS-level SecretStorage.
- 💾 **Smart Content Caching**: Caches explanations in `workspaceState` keyed by SHA-256 hashes of content + `mtime`, preventing redundant LLM calls on unchanged code.

---

## 🚀 Quick Start

1. Install the Docent extension in VS Code.
2. Open any workspace folder containing a project.
3. Click the **Docent** icon in the Activity Bar (or press `Ctrl+Shift+P` / `Cmd+Shift+P` and run `Docent: Open Sidebar`).
4. Docent immediately provides an orientation tour, project stats, and danger zones.

### Choose Your LLM Provider:
Press `Ctrl+Shift+P` / `Cmd+Shift+P` and run **`Docent: Select LLM Provider`**:
- **🤖 Local Custom Model (Recommended & Default)**: Connects to local [Ollama](https://ollama.com/) (`http://localhost:11434`) or LM Studio. 100% Free, Private, and Offline.
- **☁️ Anthropic Claude**: Uses Claude 3.5 Haiku / Sonnet via your Anthropic API Key.
- **⚡ Static Analysis Only**: Instant rule-based templates, zero model calls.

---

## 🧠 Train Your Own Custom Model

Docent includes a complete custom fine-tuning toolchain in [`training/`](training/README.md):

```bash
# 1. Generate custom dataset matching Docent's persona:
python training/dataset_generator.py --synthetic --count 300 --output docent_dataset.jsonl

# 2. Fine-tune on free Google Colab T4 GPU or local GPU:
python training/fine_tune.py --dataset docent_dataset.jsonl --output docent_custom_lora

# 3. Create model in Ollama:
ollama create docent-custom -f training/Modelfile
```

---

## ⚙️ Configuration Settings

Customize Docent via VS Code Settings (`Ctrl+,` or `Cmd+,` > search for `Docent`):

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `docent.llmProvider` | `string` | `"local"` | LLM provider: `"local"` (Ollama / custom model) or `"anthropic"` (Cloud API). |
| `docent.localEndpoint` | `string` | `"http://localhost:11434"` | Local LLM server URL (e.g. Ollama or LM Studio). |
| `docent.localModel` | `string` | `"docent-custom"` | Local model identifier (e.g. `docent-custom`, `qwen2.5-coder:1.5b`, `llama3.2:3b`). |
| `docent.localApiFormat` | `string` | `"ollama"` | Format: `"ollama"` or `"openai-compatible"`. |
| `docent.llmModel` | `string` | `"claude-3-5-haiku-20241022"` | Anthropic model for hover notes (when using Anthropic provider). |
| `docent.welcomeModel` | `string` | `"claude-3-5-sonnet-20241022"` | Anthropic model for welcome tours (when using Anthropic provider). |
| `docent.hoverExplanations` | `boolean` | `true` | Enable/disable inline hover explanations. |
| `docent.hoverFileExtensions` | `array` | `[".ts", ".js", ".tsx", ".jsx", ".py"]` | File extensions where hover explanations are active. |
| `docent.staticAnalysisOnly` | `boolean` | `false` | Force static analysis only; never send code to any LLM. |

---

## 🎯 How Danger Zones Are Scored

Docent computes danger zones automatically using local Git history via `simple-git`:

1. **Commit Frequency (Churn)**: Calculates the commit count per file across the entire repository history. Files falling in the top decile ($\ge 90\text{th}$ percentile) with above-average churn are flagged.
2. **Revert Detection**: Scans commit history for revert operations (`git log --grep=revert`) and flags touched files that have a history of breaking changes.
3. **In-Character Warnings**: Generates a witty, dry summary for each flagged file (e.g., *"Nobody's touched this without breaking something since March."*).

---

## ⌨️ Available Commands

| Command | Identifier | Description |
| :--- | :--- | :--- |
| **Docent: Select LLM Provider** | `docent.selectProvider` | Quick-switch between Local Model, Anthropic, or Static mode. |
| **Docent: Set API Key** | `docent.setApiKey` | Securely store or update your Anthropic API Key in VS Code SecretStorage. |
| **Docent: Refresh Explanations** | `docent.refreshExplanations` | Clear workspace cache and regenerate all codebase tours & hover notes. |
| **Docent: Open Sidebar** | `docent.openSidebar` | Reveal and focus the Docent sidebar tour view. |

---

## 🛠️ Development & Building

```bash
# Clone the repository
git clone https://github.com/ManjiriKench/docent.git
cd docent

# Install dependencies
npm install

# Build extension
npm run compile

# Run tests
npm test
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

