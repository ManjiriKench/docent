/**
 * llmClient.ts — Local & Anthropic API wrapper + static fallback logic.
 *
 * Supports:
 * 1. Local models (Ollama / custom local model / LM Studio / OpenAI-compatible) — 100% Free & Private.
 * 2. Anthropic Claude (Cloud API).
 * 3. Offline static analysis mode.
 *
 * If no provider is configured or if a call fails, it falls back to
 * template-based static content so the extension is always fully functional.
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
  content?: Array<{ type: string; text: string }>;
  error?: { message: string };
}

interface OllamaChatResponse {
  message?: {
    role: string;
    content: string;
  };
  response?: string;
  error?: string;
}

interface OpenAICompatibleResponse {
  choices?: Array<{
    message?: {
      content: string;
    };
    text?: string;
  }>;
  error?: {
    message: string;
  };
}

export interface LocalConnectionStatus {
  ok: boolean;
  endpoint: string;
  model: string;
  format: string;
  message: string;
  availableModels?: string[];
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

  // ── Provider & Key management ───────────────────────────────────────────────

  getProvider(): 'local' | 'anthropic' {
    return this.config.get<'local' | 'anthropic'>('llmProvider', 'local');
  }

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
    const provider = this.getProvider();
    if (provider === 'local') {
      // Local provider does not require any cloud API key
      return true;
    }
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
          return 'Key cannot be empty. Press Escape to cancel.';
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

  /**
   * Verify if the local model server (Ollama or OpenAI-compatible) is reachable.
   */
  async checkLocalConnection(): Promise<LocalConnectionStatus> {
    const endpoint = this.config.get<string>('localEndpoint', 'http://localhost:11434').replace(/\/+$/, '');
    const model = this.config.get<string>('localModel', 'docent-custom');
    const format = this.config.get<string>('localApiFormat', 'ollama');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    try {
      if (format === 'ollama') {
        const res = await fetch(`${endpoint}/api/tags`, { signal: controller.signal });
        if (!res.ok) {
          return {
            ok: false,
            endpoint,
            model,
            format,
            message: `Ollama returned HTTP ${res.status} when checking models.`,
          };
        }
        const data = (await res.json()) as { models?: Array<{ name: string }> };
        const models = (data.models || []).map((m) => m.name);
        const hasModel = models.some((m) => m === model || m.startsWith(`${model}:`));

        return {
          ok: true,
          endpoint,
          model,
          format,
          availableModels: models,
          message: hasModel
            ? `Connected to Ollama. Model '${model}' is ready.`
            : `Connected to Ollama, but model '${model}' is not in local list (${models.join(', ') || 'none'}). You can run 'ollama pull ${model}' or 'ollama create ${model} -f Modelfile'.`,
        };
      } else {
        // OpenAI-compatible endpoint check (/v1/models)
        const modelsUrl = endpoint.endsWith('/v1') ? `${endpoint}/models` : `${endpoint}/v1/models`;
        const res = await fetch(modelsUrl, { signal: controller.signal });
        if (!res.ok) {
          return {
            ok: false,
            endpoint,
            model,
            format,
            message: `Local server returned HTTP ${res.status}.`,
          };
        }
        const data = (await res.json()) as { data?: Array<{ id: string }> };
        const models = (data.data || []).map((m) => m.id);
        return {
          ok: true,
          endpoint,
          model,
          format,
          availableModels: models,
          message: `Connected to local server at ${endpoint}.`,
        };
      }
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        endpoint,
        model,
        format,
        message: `Could not connect to local server at ${endpoint}: ${errMessage}. Make sure your local server is running (e.g. 'ollama serve').`,
      };
    } finally {
      clearTimeout(timer);
    }
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

    const result = await this.generateText(WELCOME_SYSTEM_PROMPT, userMessage, 400, 30_000, 'welcome');
    if (result) {
      return result;
    }
    return this.staticWelcome(repoCtx, gitCtx);
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

    const result = await this.generateText(HOVER_SYSTEM_PROMPT, userMessage, 140, 15_000, 'hover');
    if (result) {
      return result;
    }
    return STATIC_HOVER_TEMPLATE(symbolName);
  }

  /**
   * Generate a one-liner danger note for a flagged file.
   */
  async generateDangerNote(filePath: string, commitCount: number, hasReverts: boolean): Promise<string> {
    if (this.isStaticOnlyMode() || !(await this.isConfigured())) {
      return this.staticDangerNote(filePath, commitCount, hasReverts);
    }

    const userMessage = `File: ${filePath}\nCommit count: ${commitCount}\nHas been reverted: ${hasReverts}\n\nWrite a single danger zone note for this file now.`;

    const result = await this.generateText(DANGER_ZONE_SYSTEM_PROMPT, userMessage, 60, 10_000, 'danger');
    if (result) {
      return result;
    }
    return this.staticDangerNote(filePath, commitCount, hasReverts);
  }

  // ── Dispatcher ───────────────────────────────────────────────────────────────

  private async generateText(
    systemPrompt: string,
    userMessage: string,
    maxTokens: number,
    timeoutMs: number,
    purpose: 'welcome' | 'hover' | 'danger'
  ): Promise<string | null> {
    const provider = this.getProvider();

    if (provider === 'local') {
      try {
        return await this.callLocal(systemPrompt, userMessage, maxTokens, timeoutMs);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Docent] Local LLM call failed (${purpose}): ${msg}. Falling back to static template.`);
        return null;
      }
    } else {
      try {
        const model = purpose === 'welcome'
          ? this.config.get<string>('welcomeModel', 'claude-3-5-sonnet-20241022')
          : this.config.get<string>('llmModel', 'claude-3-5-haiku-20241022');
        return await this.callAnthropic(systemPrompt, userMessage, model, maxTokens, timeoutMs);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Docent] Anthropic LLM call failed (${purpose}): ${msg}. Falling back to static template.`);
        return null;
      }
    }
  }

  // ── Local Model Call (Ollama / OpenAI-compatible) ─────────────────────────────

  private async callLocal(
    systemPrompt: string,
    userMessage: string,
    maxTokens: number,
    timeoutMs: number
  ): Promise<string> {
    const endpoint = this.config.get<string>('localEndpoint', 'http://localhost:11434').replace(/\/+$/, '');
    const model = this.config.get<string>('localModel', 'docent-custom');
    const format = this.config.get<string>('localApiFormat', 'ollama');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      if (format === 'ollama') {
        // Try Ollama native /api/chat first
        const chatUrl = `${endpoint}/api/chat`;
        const chatBody = {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          stream: false,
          options: {
            temperature: 0.3,
            num_predict: maxTokens,
          },
        };

        const res = await fetch(chatUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(chatBody),
          signal: controller.signal,
        });

        if (res.ok) {
          const data = (await res.json()) as OllamaChatResponse;
          const text = data.message?.content?.trim();
          if (text) {
            return text;
          }
        }

        // If /api/chat failed or returned empty, try fallback /api/generate
        const genUrl = `${endpoint}/api/generate`;
        const genBody = {
          model,
          system: systemPrompt,
          prompt: userMessage,
          stream: false,
          options: {
            temperature: 0.3,
            num_predict: maxTokens,
          },
        };

        const genRes = await fetch(genUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(genBody),
          signal: controller.signal,
        });

        if (!genRes.ok) {
          const errData = (await genRes.json().catch(() => ({}))) as OllamaChatResponse;
          throw new Error(`Ollama error ${genRes.status}: ${errData.error || genRes.statusText}`);
        }

        const genData = (await genRes.json()) as OllamaChatResponse;
        const genText = genData.response?.trim();
        if (!genText) {
          throw new Error('Ollama returned empty response');
        }
        return genText;
      } else {
        // OpenAI-compatible format (LM Studio, vLLM, LocalAI)
        const url = endpoint.includes('/chat/completions')
          ? endpoint
          : endpoint.endsWith('/v1')
          ? `${endpoint}/chat/completions`
          : `${endpoint}/v1/chat/completions`;

        const body = {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          max_tokens: maxTokens,
          temperature: 0.3,
        };

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as OpenAICompatibleResponse;
          throw new Error(`Local server error ${res.status}: ${errData.error?.message || res.statusText}`);
        }

        const data = (await res.json()) as OpenAICompatibleResponse;
        const text = data.choices?.[0]?.message?.content?.trim() ?? data.choices?.[0]?.text?.trim();
        if (!text) {
          throw new Error('Local server returned empty response');
        }
        return text;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Anthropic Cloud API ──────────────────────────────────────────────────────

  private async callAnthropic(
    systemPrompt: string,
    userMessage: string,
    model: string,
    maxTokens: number,
    timeoutMs: number
  ): Promise<string> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new Error('No API key configured for Anthropic provider');
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

  private isStaticOnlyMode(): boolean {
    return this.config.get<boolean>('staticAnalysisOnly', false);
  }
}

