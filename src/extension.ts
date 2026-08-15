/**
 * extension.ts — Docent extension entry point.
 *
 * Activates on startup (or when workspace contains files), initializes
 * the static scanner, git analyzer, LLM client, cache, and registers the
 * sidebar WebviewViewProvider and HoverProvider.
 */

import * as vscode from 'vscode';
import { LLMClient } from './docent/llmClient';
import { DocentCache } from './docent/cache';
import { SidebarProvider } from './views/sidebarProvider';
import { DocentHoverProvider, buildDocumentSelector } from './views/hoverProvider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const workspaceRoot = workspaceFolders && workspaceFolders.length > 0
    ? workspaceFolders[0].uri.fsPath
    : undefined;

  const config = vscode.workspace.getConfiguration('docent');
  const cache = new DocentCache(context.workspaceState);
  const llmClient = new LLMClient(context.secrets, config);

  // ── First-run API key check ────────────────────────────────────────────────
  const hasPromptedKey = context.globalState.get<boolean>('docent.hasPromptedApiKey', false);
  const hasKey = await llmClient.isConfigured();
  const staticOnly = config.get<boolean>('staticAnalysisOnly', false);

  if (!hasPromptedKey && !hasKey && !staticOnly) {
    // Prompt once non-intrusively
    void context.globalState.update('docent.hasPromptedApiKey', true);
    void vscode.window.showInformationMessage(
      'Docent is ready! To unlock AI-powered codebase narrations, configure your Anthropic API key.',
      'Set API Key',
      'Use Static Mode'
    ).then(async (selection) => {
      if (selection === 'Set API Key') {
        const saved = await llmClient.promptApiKey();
        if (saved) {
          vscode.window.showInformationMessage('Docent: API key saved securely! Refreshing orientation…');
          void sidebarProvider.refresh();
        }
      }
    });
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
