# Docent 🏛️

> **A friendly, character-voiced guide to any codebase — automatically generated from the code itself.**

Orienting yourself in an unfamiliar repository usually takes hours of clicking around or finding a senior engineer to give you a tour. Unlike tools like CodeTour or Swimm that require someone to hand-author walkthroughs, **Docent generates its explanations automatically from the code itself**, dynamically updating as the repository evolves.

---

## ✨ Features

- 🎩 **Museum-Guide Persona**: Knowledgeable, warm, slightly dry, and never condescending. Think *"helpful senior dev who's shown five people around this codebase and has a few good lines about it."*
- ⚡ **Zero-Config Static Mode**: Works instantly with zero API keys or external calls. Analyzes manifests, directory layouts, and Git history natively.
- ⚠️ **Git Danger Zone Radar**: Flags high-churn hotspots (top-decile commit frequencies) and files with historical reverts, giving you a heads-up on tricky areas before you edit.
- 💡 **Contextual Hover Explanations**: Hover over any function or class declaration across TypeScript, JavaScript, Python, or JSX to see what it does and why it exists.
- 🔒 **Privacy-First & Secure**: API keys are stored in VS Code's native OS-level SecretStorage (`context.secrets`). Enable `docent.staticAnalysisOnly` to guarantee zero network traffic.
- 🧠 **Smart Content Caching**: Caches explanations in `workspaceState` keyed by SHA-256 hashes of content + `mtime`, preventing redundant LLM calls on unchanged code.

---

## 📸 Preview

![Docent Sidebar Preview](https://raw.githubusercontent.com/ManjiriKench/docent/main/media/docent-character.svg)

---

## 🚀 Quick Start

1. Install the Docent extension in VS Code.
2. Open any workspace folder containing a project.
3. Click the **Docent** icon in the Activity Bar (or run `Docent: Open Sidebar` from the Command Palette `Ctrl+Shift+P` / `Cmd+Shift+P`).
4. Docent will immediately provide an orientation tour, project stats, and danger zones.

### Optional: Enable AI Narration (Anthropic Claude)
1. Press `Ctrl+Shift+P` / `Cmd+Shift+P` and type `Docent: Set API Key`.
2. Enter your Anthropic API Key (`sk-ant-...`).
3. Docent will refresh with rich, character-voiced narrations!

---

## ⚙️ Configuration Settings

Customize Docent via your VS Code Settings (`Ctrl+,` or `Cmd+,` > search for `Docent`):

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `docent.llmProvider` | `string` | `"anthropic"` | LLM provider to use for explanations. |
| `docent.llmModel` | `string` | `"claude-3-5-haiku-20241022"` | Anthropic model for hover explanations (fast and cost-efficient). |
| `docent.welcomeModel` | `string` | `"claude-3-5-sonnet-20241022"` | Anthropic model for sidebar welcome tours (richer prose). |
| `docent.hoverExplanations` | `boolean` | `true` | Enable/disable inline hover explanations. |
| `docent.hoverFileExtensions` | `array` | `[".ts", ".js", ".tsx", ".jsx", ".py"]` | File extensions where hover explanations are active. |
| `docent.staticAnalysisOnly` | `boolean` | `false` | Force static analysis only; never send code to external LLMs. |

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
