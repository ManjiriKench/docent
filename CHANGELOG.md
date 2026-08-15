# Changelog

All notable changes to the **Docent** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.0.1] - 2026-08-15

### Added
- **Character-Voiced Sidebar Tour**: An automatic museum-guide orientation to any opened codebase explaining its structure, purpose, and entry points.
- **Robust Static-Analysis Fallback**: Zero-config mode analyzing manifests, directory layouts, and Git history without sending any code to LLM endpoints.
- **Git Danger Zone Radar**: Identifies high-churn files (top-decile commit frequencies) and files with historical reverts using `simple-git`.
- **Smart Inline Hover Explanations**: Registered hover provider for TypeScript, JavaScript, React, and Python files with intelligent caching.
- **Secure Key Management**: Integrated Anthropic API key storage via VS Code's `context.secrets` (SecretStorage API).
- **Workspace State Caching**: SHA-256 content + mtime hashed caching to prevent redundant API calls on unchanged files.
- **Privacy Mode**: `docent.staticAnalysisOnly` configuration toggle for air-gapped and privacy-sensitive codebases.
