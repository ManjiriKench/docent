/**
 * llmClient.ts — Anthropic API wrapper + static fallback logic.
 *
 * All LLM calls go through this module. If no API key is set, or if
 * a call fails, it falls back to template-based static content so
 * the extension is never useless without a key.
 */

import * as vscode from 'vscode';
import {
  WELCOME_SYSTEM_PROMPT,
  HOVER_SYSTEM_PROMPT,
  DANGER_ZONE_SYSTEM_PROMPT,
  STATIC_WELCOME_TEMPLATE,
  STATIC_HOVER_TEMPLATE,
} from './persona';
import { RepoContext, RepoScanner } from './scanner';
import { GitContext, GitAnalyzer } from './gitAnalyzer';

// ── Types ────────────────────────────────────────────────────────────────────

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: AnthropicMessage[];
}

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
  error?: { message: string };
}

const SECRET_KEY = 'docent.anthropicApiKey';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// ── LLMClient ────────────────────────────────────────────────────────────────

export class LLMClient {
  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly config: vscode.WorkspaceConfiguration
  ) {}

  // ── Key management ───────────────────────────────────────────────────────────

  async getApiKey(): Promise<string | undefined> {
    // 1. Check process.env (e.g. loaded from .env)
    if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim().length > 0) {
      return process.env.ANTHROPIC_API_KEY.trim();
    }

    // 2. Check VS Code SecretStorage
    const key = await this.secrets.get(SECRET_KEY);
    if (key && key.trim().length > 0) {
      return key.trim();
    }

    return undefined;
  }

  async isConfigured(): Promise<boolean> {
    const key = await this.getApiKey();
    return !!key;
  }

  /**
   * Prompt the user for their Anthropic API key and store it securely.
   * Returns true if a key was provided, false if the user cancelled.
   */
  async promptApiKey(): Promise<boolean> {
    const key = await vscode.window.showInputBox({
      title: 'Docent — Anthropic API Key',
      prompt: 'Enter your Anthropic API key (starts with sk-ant-). It will be stored securely in VS Code\'s secret storage.',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Key cannot be empty. Press Escape to skip — Docent will use static analysis mode.';
        }
        return null;
      },
    });

    if (!key) {
      return false;
    }

    await this.secrets.store(SECRET_KEY, key.trim());
    return true;
  }

  async deleteApiKey(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
  }

  // ── Public generation methods ────────────────────────────────────────────────

  /**
   * Generate (or return a static fallback for) the sidebar welcome narration.
   */
  async generateWelcome(repoCtx: RepoContext, gitCtx: GitContext): Promise<string> {
    if (this.isStaticOnlyMode() || !(await this.isConfigured())) {
      return this.staticWelcome(repoCtx, gitCtx);
    }

    const repoSummary = RepoScanner.formatForPrompt(repoCtx);
    const gitSummary = GitAnalyzer.formatForPrompt(gitCtx);

    const userMessage = `Here is the repository I need you to introduce:\n\n${repoSummary}\n\n${gitSummary}\n\nPlease write the welcome narration now.`;

    try {
      const model = this.config.get<string>('welcomeModel', 'claude-3-5-sonnet-20241022');
      return await this.callAnthropic(WELCOME_SYSTEM_PROMPT, userMessage, model, 400, 30_000);
    } catch (err) {
      console.error('[Docent] LLM welcome call failed, using fallback:', err);
      return this.staticWelcome(repoCtx, gitCtx);
    }
  }

  /**
   * Generate a hover explanation for a named symbol.
   */
  async generateHover(
    symbolName: string,
    symbolContext: string,
    filePath: string
  ): Promise<string> {
    if (this.isStaticOnlyMode() || !(await this.isConfigured())) {
      return STATIC_HOVER_TEMPLATE(symbolName);
    }

    const userMessage = `File: ${filePath}\n\nCode context around the symbol:\n\`\`\`\n${symbolContext.slice(0, 1500)}\n\`\`\`\n\nSymbol to explain: \`${symbolName}\`\n\nWrite the hover explanation now.`;

    try {
      const model = this.config.get<string>('llmModel', 'claude-3-5-haiku-20241022');
      return await this.callAnthropic(HOVER_SYSTEM_PROMPT, userMessage, model, 120, 12_000);
    } catch (err) {
      console.error('[Docent] LLM hover call failed, using fallback:', err);
      return STATIC_HOVER_TEMPLATE(symbolName);
    }
  }

  /**
   * Generate a one-liner danger note for a flagged file.
   */
  async generateDangerNote(filePath: string, commitCount: number, hasReverts: boolean): Promise<string> {
    if (this.isStaticOnlyMode() || !(await this.isConfigured())) {
      return this.staticDangerNote(filePath, commitCount, hasReverts);
    }

    const userMessage = `File: ${filePath}\nCommit count: ${commitCount}\nHas been reverted: ${hasReverts}\n\nWrite a single danger zone note for this file now.`;

    try {
      const model = this.config.get<string>('llmModel', 'claude-3-5-haiku-20241022');
      return await this.callAnthropic(DANGER_ZONE_SYSTEM_PROMPT, userMessage, model, 60, 10_000);
    } catch (err) {
      return this.staticDangerNote(filePath, commitCount, hasReverts);
    }
  }

  // ── Static fallbacks ─────────────────────────────────────────────────────────

  private staticWelcome(repoCtx: RepoContext, gitCtx: GitContext): string {
    const projectName = repoCtx.manifest?.name || 'this project';
    const topDeps = Object.keys(repoCtx.manifest?.dependencies || {});
    const topChurnFiles = Array.from(gitCtx.fileChurnMap.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([f]) => f);

    const folderCount = repoCtx.folderStructure.filter((e) => e.isDirectory).length;

    return STATIC_WELCOME_TEMPLATE(
      projectName,
      folderCount,
      repoCtx.totalFiles,
      topDeps,
      gitCtx.contributors.length,
      gitCtx.totalCommits,
      topChurnFiles
    );
  }

  private staticDangerNote(filePath: string, commitCount: number, hasReverts: boolean): string {
    const name = filePath.split('/').pop() || filePath;
    if (hasReverts) {
      return `${name} has been reverted before — ${commitCount} commits and not all of them stuck.`;
    }
    return `${name} — ${commitCount} commits. High churn. Look before you leap.`;
  }

  // ── Core API call ────────────────────────────────────────────────────────────

  private async callAnthropic(
    systemPrompt: string,
    userMessage: string,
    model: string,
    maxTokens: number,
    timeoutMs: number
  ): Promise<string> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new Error('No API key configured');
    }

    const body: AnthropicRequest = {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const data = (await response.json()) as AnthropicResponse;

      if (!response.ok) {
        throw new Error(`Anthropic API error ${response.status}: ${data.error?.message ?? 'Unknown error'}`);
      }

      const text = data.content?.find((c) => c.type === 'text')?.text;
      if (!text) {
        throw new Error('Anthropic returned no text content');
      }

      return text.trim();
    } finally {
      clearTimeout(timer);
    }
  }

  private isStaticOnlyMode(): boolean {
    return this.config.get<boolean>('staticAnalysisOnly', false);
  }
}
