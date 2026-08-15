/**
 * extension.ts — Docent extension entry point.
 *
 * Activates on startup (or when workspace contains files), initializes
 * the static scanner, git analyzer, LLM client, cache, and registers the
 * sidebar WebviewViewProvider and HoverProvider.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LLMClient } from './docent/llmClient';
import { DocentCache } from './docent/cache';
import { SidebarProvider } from './views/sidebarProvider';
import { DocentHoverProvider, buildDocumentSelector } from './views/hoverProvider';

function loadEnvFile(candidatePaths: (string | undefined)[]): void {
  for (const dirPath of candidatePaths) {
    if (!dirPath) continue;
    const envPath = path.join(dirPath, '.env');
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
            if (key && val) {
              process.env[key] = val;
            }
          }
        }
      } catch (err) {
        console.error('[Docent] Failed to read .env from ' + envPath, err);
      }
    }
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const workspaceRoot = workspaceFolders && workspaceFolders.length > 0
    ? workspaceFolders[0].uri.fsPath
    : undefined;

  // Search extension root, dist parent, extensionPath, and workspaceRoot for .env
  loadEnvFile([
    context.extensionUri?.fsPath,
    context.extensionPath,
    path.resolve(__dirname, '..'),
    workspaceRoot,
  ]);

  if (process.env.ANTHROPIC_API_KEY) {
    console.log('[Docent] ANTHROPIC_API_KEY detected and loaded successfully.');
  }

  const config = vscode.workspace.getConfiguration('docent');
  const cache = new DocentCache(context.workspaceState);
  const llmClient = new LLMClient(context.secrets, config);

  // ── First-run check ────────────────────────────────────────────────────────
  const hasPrompted = context.globalState.get<boolean>('docent.hasPromptedSetup', false);
  const provider = llmClient.getProvider();
  const staticOnly = config.get<boolean>('staticAnalysisOnly', false);

  if (!hasPrompted && !staticOnly) {
    void context.globalState.update('docent.hasPromptedSetup', true);
    if (provider === 'local') {
      void llmClient.checkLocalConnection().then((status) => {
        if (!status.ok) {
          vscode.window.showInformationMessage(
            'Docent is configured to use your Local Model (Ollama). Start Ollama ("ollama serve") to enable AI explanations, or choose another provider.',
            'Select Provider',
            'Dismiss'
          ).then((sel) => {
            if (sel === 'Select Provider') {
              void vscode.commands.executeCommand('docent.selectProvider');
            }
          });
        }
      });
    } else if (provider === 'anthropic') {
      const hasKey = await llmClient.isConfigured();
      if (!hasKey) {
        void vscode.window.showInformationMessage(
          'Docent: To use Anthropic Claude, please configure your API key, or switch to a free Local Model.',
          'Set API Key',
          'Use Local Model (Free)'
        ).then(async (selection) => {
          if (selection === 'Set API Key') {
            const saved = await llmClient.promptApiKey();
            if (saved) {
              vscode.window.showInformationMessage('Docent: API key saved securely!');
              void sidebarProvider.refresh();
            }
          } else if (selection === 'Use Local Model (Free)') {
            await config.update('docent.llmProvider', 'local', vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('Docent: Switched to Local Model provider.');
            void sidebarProvider.refresh();
          }
        });
      }
    }
  }

  // ── Sidebar Provider ───────────────────────────────────────────────────────
  const sidebarProvider = new SidebarProvider(
    context.extensionUri,
    llmClient,
    cache,
    workspaceRoot
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewId,
      sidebarProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }
    )
  );

  // ── Hover Provider ─────────────────────────────────────────────────────────
  const hoverExtensions = config.get<string[]>('hoverFileExtensions', [
    '.ts',
    '.js',
    '.tsx',
    '.jsx',
    '.py',
  ]);
  const selector = buildDocumentSelector(hoverExtensions);
  const hoverProvider = new DocentHoverProvider(llmClient, cache);

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, hoverProvider)
  );

  // ── Commands ───────────────────────────────────────────────────────────────

  // Command: Select Provider (Local / Anthropic / Static)
  context.subscriptions.push(
    vscode.commands.registerCommand('docent.selectProvider', async () => {
      const currentProvider = llmClient.getProvider();
      const currentStatic = config.get<boolean>('staticAnalysisOnly', false);

      const items: (vscode.QuickPickItem & { providerValue: 'local' | 'anthropic' | 'static' })[] = [
        {
          label: '$(chip) Local Custom Model (Ollama / Self-Hosted)',
          description: currentProvider === 'local' && !currentStatic ? 'Currently active' : '',
          detail: '100% Free, Private & Offline. Runs on your machine with zero API keys or billing limits.',
          providerValue: 'local',
        },
        {
          label: '$(cloud) Anthropic Claude (Cloud API)',
          description: currentProvider === 'anthropic' && !currentStatic ? 'Currently active' : '',
          detail: 'Uses Claude 3.5 Haiku / Sonnet via Anthropic API key.',
          providerValue: 'anthropic',
        },
        {
          label: '$(shield) Static Analysis Only (Offline / Zero Model)',
          description: currentStatic ? 'Currently active' : '',
          detail: 'Never calls any LLM. Generates instant structural codebase summaries.',
          providerValue: 'static',
        },
      ];

      const selected = await vscode.window.showQuickPick(items, {
        title: 'Docent: Select LLM Provider',
        placeHolder: 'Choose how Docent should generate explanations',
      });

      if (!selected) {
        return;
      }

      const cfg = vscode.workspace.getConfiguration('docent');

      if (selected.providerValue === 'static') {
        await cfg.update('staticAnalysisOnly', true, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('Docent: Switched to Static Analysis mode.');
      } else if (selected.providerValue === 'local') {
        await cfg.update('staticAnalysisOnly', false, vscode.ConfigurationTarget.Global);
        await cfg.update('docent.llmProvider', 'local', vscode.ConfigurationTarget.Global);
        const status = await llmClient.checkLocalConnection();
        if (status.ok) {
          vscode.window.showInformationMessage(`Docent: Switched to Local Model. Connected to ${status.endpoint} (${status.model}).`);
        } else {
          vscode.window.showWarningMessage(`Docent: Switched to Local Model. ${status.message}`);
        }
      } else if (selected.providerValue === 'anthropic') {
        await cfg.update('staticAnalysisOnly', false, vscode.ConfigurationTarget.Global);
        await cfg.update('docent.llmProvider', 'anthropic', vscode.ConfigurationTarget.Global);
        const hasKey = await llmClient.isConfigured();
        if (!hasKey) {
          await llmClient.promptApiKey();
        }
        vscode.window.showInformationMessage('Docent: Switched to Anthropic Claude provider.');
      }

      await sidebarProvider.refresh();
    })
  );

  // Command: Set API Key
  context.subscriptions.push(
    vscode.commands.registerCommand('docent.setApiKey', async () => {
      const saved = await llmClient.promptApiKey();
      if (saved) {
        vscode.window.showInformationMessage('Docent: Anthropic API key updated successfully.');
        await sidebarProvider.refresh();
      }
    })
  );

  // Command: Refresh Explanations
  context.subscriptions.push(
    vscode.commands.registerCommand('docent.refreshExplanations', async () => {
      await sidebarProvider.refresh();
      vscode.window.showInformationMessage('Docent: Explanations refreshed and cache cleared.');
    })
  );

  // Command: Open Sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand('docent.openSidebar', async () => {
      await vscode.commands.executeCommand('docentView.focus');
    })
  );
}

export function deactivate(): void {
  // Clean-up if needed
}

