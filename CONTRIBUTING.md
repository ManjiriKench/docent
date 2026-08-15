# Contributing to Docent 🏛️

Welcome to **Docent**! We are thrilled you're interested in contributing. Whether you are part of Astra Club or the wider developer community, this guide will get you set up quickly.

---

## 🛠️ Development Setup

### Prerequisites
- **Node.js**: v18.0.0 or higher (v20+ recommended)
- **Git**: v2.30+
- **VS Code**: v1.85.0+

### Clone & Install
```bash
git clone https://github.com/ManjiriKench/docent.git
cd docent
npm install
```

### Build & Watch
Docent uses `esbuild` for lightning-fast bundles:
```bash
# Build once
npm run compile

# Continuous watch mode
npm run watch
```

---

## 🚀 Running & Debugging Locally

1. Open the `docent` folder in VS Code.
2. Press `F5` (or go to **Run and Debug** > **Run Extension**).
3. A new **Extension Development Host** window will open with Docent active.
4. Click the Docent guide icon in the Activity Bar or run `Docent: Open Sidebar` from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).

---

## 🧪 Running Tests & Type Checks

```bash
# Run TypeScript typecheck
npm run typecheck

# Compile test suite
npm run compile-tests

# Run integration tests
npm test
```

---

## 🏗️ Architecture Overview

```
src/
├── extension.ts          # Extension lifecycle & command registration
├── docent/
│   ├── scanner.ts        # Static repository manifest & folder analysis
│   ├── gitAnalyzer.ts    # simple-git wrapper, churn metrics & danger zones
│   ├── llmClient.ts      # Anthropic API client with fallback logic
│   ├── cache.ts          # workspaceState SHA-256 caching layer
│   └── persona.ts        # Museum guide voice definitions & prompts
└── views/
    ├── sidebarProvider.ts# WebviewViewProvider for the Activity Bar panel
    └── hoverProvider.ts  # Inline hover explanation provider
```

---

## 💡 Code Guidelines & Style

- **Strict TypeScript**: Ensure `npm run typecheck` passes with zero warnings.
- **Fail-Safe Fallbacks**: Never allow an LLM call failure or missing API key to crash or blank out the UI. Static fallbacks are first-class citizen features.
- **No Direct Shelling**: Use the provided `simple-git` instance for git operations.
- **Persona Voice**: Maintain the museum docent's warm, slightly dry, helpful tone in LLM prompts. Avoid corporate jargon.

---

## 📮 Pull Request Process

1. Create a feature branch (`git checkout -b feat/your-feature-name`).
2. Make granular, meaningful commits (`git commit -m "feat(hover): add support for rust declarations"`).
3. Ensure `npm run typecheck` and `npm run compile` pass cleanly.
4. Push to your branch and open a Pull Request against `main`.
