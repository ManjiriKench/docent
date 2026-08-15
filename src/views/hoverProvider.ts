/**
 * hoverProvider.ts — Inline hover explanations for named declarations.
 *
 * Registers a HoverProvider for configured file extensions.
 * Returns a Promise<Hover> — VS Code resolves this and shows the result.
 * Cache is checked first (synchronous-ish via workspaceState), so cached
 * explanations appear instantly; fresh ones show a "thinking" state.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { LLMClient } from '../docent/llmClient';
import { DocentCache } from '../docent/cache';

// ── Symbol detection ──────────────────────────────────────────────────────────

/**
 * Regex patterns for named function/class declarations across languages.
 * These are intentionally simple — we detect the declaration line, not
 * the entire AST, which keeps the bundle lean.
 */
const DECLARATION_PATTERNS = [
  // TypeScript / JavaScript
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/,
  /^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function/,
  /^\s*(?:public|private|protected|static|async|override)[\s\w]*?\s+(\w+)\s*\(/,
  // Python
  /^\s*(?:async\s+)?def\s+(\w+)\s*\(/,
  /^\s*class\s+(\w+)\s*[:(]/,
];

interface SymbolMatch {
  name: string;
  lineIndex: number;
}

function detectSymbolAtLine(document: vscode.TextDocument, line: number): SymbolMatch | null {
  const lineText = document.lineAt(line).text;
  for (const pattern of DECLARATION_PATTERNS) {
    const match = lineText.match(pattern);
    if (match?.[1]) {
      return { name: match[1], lineIndex: line };
    }
  }
  return null;
}

/**
 * Get surrounding code context (20 lines before + 20 after) for the LLM.
 */
function getSymbolContext(document: vscode.TextDocument, line: number): string {
  const start = Math.max(0, line - 5);
  const end = Math.min(document.lineCount - 1, line + 25);
  const lines: string[] = [];
  for (let i = start; i <= end; i++) {
    lines.push(document.lineAt(i).text);
  }
  return lines.join('\n');
}

// ── HoverProvider ─────────────────────────────────────────────────────────────

export class DocentHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly llmClient: LLMClient,
    private readonly cache: DocentCache
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    const config = vscode.workspace.getConfiguration('docent');
    if (!config.get<boolean>('hoverExplanations', true)) {
      return null;
    }

    // Detect if we're on a named declaration line
    const symbol = detectSymbolAtLine(document, position.line);
    if (!symbol) {
      return null;
    }

    const filePath = document.uri.fsPath;
    const fileContent = document.getText();
    const mtime = (await vscode.workspace.fs.stat(document.uri)).mtime;

    // Cache key: symbol name + file content hash + mtime
    const cacheHash = this.cache.computeHash(`${symbol.name}::${fileContent}`, mtime);

    // Check cache first — return immediately if hit
    const cached = this.cache.getCachedHover(cacheHash);
    if (cached) {
      if (token.isCancellationRequested) {
        return null;
      }
      return this.buildHover(cached, symbol.name);
    }

    // No cache — show thinking state, then resolve
    if (token.isCancellationRequested) {
      return null;
    }

    // Return a promise — VS Code will show loading indicator
    const context = getSymbolContext(document, symbol.lineIndex);
    const relPath = vscode.workspace.asRelativePath(filePath);

    try {
      const explanation = await this.llmClient.generateHover(symbol.name, context, relPath);

      if (token.isCancellationRequested) {
        return null;
      }

      // Cache the result for next time
      void this.cache.setCachedHover(cacheHash, explanation);

      return this.buildHover(explanation, symbol.name);
    } catch {
      return null;
    }
  }

  private buildHover(text: string, symbolName: string): vscode.Hover {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = false;
    md.appendMarkdown(`**🎩 Docent** — \`${symbolName}\`\n\n`);
    md.appendMarkdown(text);
    md.appendMarkdown('\n\n---\n*Powered by Docent · [Refresh](command:docent.refreshExplanations)*');
    return new vscode.Hover(md);
  }
}

/**
 * Build the document selector for hover registration based on config.
 */
export function buildDocumentSelector(
  extensions: string[]
): vscode.DocumentSelector {
  return extensions.map((ext) => ({
    scheme: 'file',
    pattern: `**/*${ext}`,
  }));
}
