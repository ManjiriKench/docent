/**
 * sidebarProvider.ts — WebviewViewProvider for the Docent sidebar panel.
 *
 * Renders the welcome narration, repo stats, and danger zone flags in a
 * dedicated Activity Bar container. All data processing happens here in
 * the extension host; the webview is a pure renderer.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { LLMClient } from '../docent/llmClient';
import { DocentCache } from '../docent/cache';
import { RepoContext, RepoScanner } from '../docent/scanner';
import { GitContext, GitAnalyzer } from '../docent/gitAnalyzer';

// ── Message types (extension host ↔ webview) ─────────────────────────────────

interface WelcomeMessage {
  type: 'welcome';
  text: string;
  isStatic: boolean;
  repoMeta: RepoMeta;
  dangerZones: SerializedDangerZone[];
  contributors: number;
  totalCommits: number;
  fileBreakdown: [string, number][];
}

interface StatusMessage {
  type: 'status';
  text: string;
}

interface ErrorMessage {
  type: 'error';
  text: string;
}

type OutboundMessage = WelcomeMessage | StatusMessage | ErrorMessage;

interface RepoMeta {
  name: string;
  description: string;
  version: string;
  totalFiles: number;
  isGitRepo: boolean;
}

interface SerializedDangerZone {
  filePath: string;
  commitCount: number;
  reason: string;
  hasReverts: boolean;
}

// ── SidebarProvider ──────────────────────────────────────────────────────────

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'docentView';

  private view?: vscode.WebviewView;
  private repoCtx?: RepoContext;
  private gitCtx?: GitContext;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly llmClient: LLMClient,
    private readonly cache: DocentCache,
    private readonly workspaceRoot: string | undefined
  ) {}

  // ── WebviewViewProvider interface ────────────────────────────────────────────

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage((message: { type: string }) => {
      if (message.type === 'ready') {
        void this.loadContent();
      }
      if (message.type === 'refresh') {
        void this.cache.clearAll();
        void this.loadContent();
      }
    });

    // Load content immediately
    void this.loadContent();
  }

  /**
   * Force a content refresh (called by the Refresh Explanations command).
   */
  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    await this.cache.clearAll();
    await this.loadContent();
  }

  // ── Content loading ──────────────────────────────────────────────────────────

  private async loadContent(): Promise<void> {
    if (!this.view) {
      return;
    }

    if (!this.workspaceRoot) {
      this.postMessage({
        type: 'status',
        text: 'Open a workspace folder to get a Docent tour.',
      });
      return;
    }

    this.postMessage({ type: 'status', text: 'Scanning repository…' });

    try {
      // Static analysis (always runs)
      const scanner = new RepoScanner(this.workspaceRoot);
      const analyzer = new GitAnalyzer(this.workspaceRoot);

      const [repoCtx, gitCtx] = await Promise.all([
        scanner.buildContext(),
        analyzer.buildContext(),
      ]);

      this.repoCtx = repoCtx;
      this.gitCtx = gitCtx;

      // Enrich danger zones with revert info
      const enrichedDangerZones = await analyzer.enrichWithRevertInfo(gitCtx.dangerZones);

      // Compute cache key from manifest content + total file count
      const cacheInput = JSON.stringify({
        name: repoCtx.manifest?.name,
        deps: Object.keys(repoCtx.manifest?.dependencies || {}),
        totalFiles: repoCtx.totalFiles,
        totalCommits: gitCtx.totalCommits,
        topDangerZones: enrichedDangerZones.slice(0, 3).map((d) => d.filePath),
      });
      const cacheHash = this.cache.computeHash(cacheInput, gitCtx.totalCommits);

      this.postMessage({ type: 'status', text: 'Generating welcome narration…' });

      // Check cache first
      let welcomeText = this.cache.getCachedWelcome(cacheHash);
      const isConfigured = await this.llmClient.isConfigured();
      if (welcomeText && welcomeText.includes('static analysis') && isConfigured) {
        welcomeText = undefined; // Invalidate previous static cache
      }

      let isStatic = false;

      if (!welcomeText) {
        welcomeText = await this.llmClient.generateWelcome(repoCtx, gitCtx);
        isStatic = !isConfigured || welcomeText.includes('static analysis');
        if (!isStatic) {
          await this.cache.setCachedWelcome(cacheHash, welcomeText);
        }
      } else {
        isStatic = !isConfigured || welcomeText.includes('static analysis');
      }

      // Serialise danger zones (generate LLM notes for top 5)
      const serializedDangerZones: SerializedDangerZone[] = await Promise.all(
        enrichedDangerZones.slice(0, 8).map(async (dz) => {
          const noteHash = this.cache.computeHash(dz.filePath, dz.commitCount);
          let reason = this.cache.getCachedDangerNote(noteHash);
          if (!reason) {
            reason = await this.llmClient.generateDangerNote(
              dz.filePath,
              dz.commitCount,
              dz.hasReverts
            );
            await this.cache.setCachedDangerNote(noteHash, reason);
          }
          return {
            filePath: dz.filePath,
            commitCount: dz.commitCount,
            reason,
            hasReverts: dz.hasReverts,
          };
        })
      );

      // File extension breakdown (top 6)
      const fileBreakdown: [string, number][] = Object.entries(repoCtx.fileExtensionBreakdown)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 6);

      const repoName = repoCtx.manifest?.name || 'this project';

      this.postMessage({
        type: 'welcome',
        text: welcomeText,
        isStatic,
        repoMeta: {
          name: repoName,
          description: repoCtx.manifest?.description || '',
          version: repoCtx.manifest?.version || '',
          totalFiles: repoCtx.totalFiles,
          isGitRepo: gitCtx.isGitRepo,
        },
        dangerZones: serializedDangerZones,
        contributors: gitCtx.contributors.length,
        totalCommits: gitCtx.totalCommits,
        fileBreakdown,
      });
    } catch (err) {
      console.error('[Docent] Error loading sidebar content:', err);
      this.postMessage({
        type: 'error',
        text: 'Docent ran into trouble scanning this repo. Check the Output panel for details.',
      });
    }
  }

  private postMessage(message: OutboundMessage): void {
    void this.view?.webview.postMessage(message);
  }

  // ── HTML ─────────────────────────────────────────────────────────────────────

  private getHtmlContent(webview: vscode.Webview): string {
    const mediaPath = vscode.Uri.joinPath(this.extensionUri, 'media');
    const htmlPath = vscode.Uri.joinPath(mediaPath, 'sidebar.html');
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaPath, 'sidebar.css'));
    const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaPath, 'docent-character.svg'));

    const nonce = this.getNonce();
    const cspSource = webview.cspSource;

    let html = fs.readFileSync(htmlPath.fsPath, 'utf8');
    html = html
      .replace(/\{\{nonce\}\}/g, nonce)
      .replace(/\{\{cspSource\}\}/g, cspSource)
      .replace(/\{\{cssUri\}\}/g, cssUri.toString())
      .replace(/\{\{iconUri\}\}/g, iconUri.toString());

    return html;
  }

  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
