/**
 * cache.ts — workspaceState-backed caching helpers.
 *
 * Caches LLM-generated explanations keyed by a SHA-256 hash of the
 * relevant content + mtime. This means a re-open or window reload
 * reuses the cached text without re-calling the API, unless the file
 * has actually changed.
 */

import * as crypto from 'crypto';
import * as vscode from 'vscode';

const CACHE_PREFIX_WELCOME = 'docent.cache.welcome.';
const CACHE_PREFIX_HOVER = 'docent.cache.hover.';
const CACHE_PREFIX_DANGER = 'docent.cache.danger.';

export interface CachedEntry {
  text: string;
  timestamp: number;
}

export class DocentCache {
  constructor(private readonly state: vscode.Memento) {}

  // ── Hash helpers ────────────────────────────────────────────────────────────

  /**
   * Compute a deterministic SHA-256 hash from content + mtime.
   * mtime can be a number (ms since epoch) or a string identifier.
   */
  computeHash(content: string, mtime: number | string): string {
    return crypto
      .createHash('sha256')
      .update(`${content}::${mtime}`)
      .digest('hex')
      .slice(0, 32); // 32 hex chars is plenty for a cache key
  }

  // ── Welcome (repo-level) ────────────────────────────────────────────────────

  getCachedWelcome(hash: string): string | undefined {
    const entry = this.state.get<CachedEntry>(`${CACHE_PREFIX_WELCOME}${hash}`);
    return entry?.text;
  }

  async setCachedWelcome(hash: string, text: string): Promise<void> {
    await this.state.update(`${CACHE_PREFIX_WELCOME}${hash}`, {
      text,
      timestamp: Date.now(),
    } satisfies CachedEntry);
  }

  // ── Hover (per-symbol) ──────────────────────────────────────────────────────

  getCachedHover(hash: string): string | undefined {
    const entry = this.state.get<CachedEntry>(`${CACHE_PREFIX_HOVER}${hash}`);
    return entry?.text;
  }

  async setCachedHover(hash: string, text: string): Promise<void> {
    await this.state.update(`${CACHE_PREFIX_HOVER}${hash}`, {
      text,
      timestamp: Date.now(),
    } satisfies CachedEntry);
  }

  // ── Danger zone notes ───────────────────────────────────────────────────────

  getCachedDangerNote(hash: string): string | undefined {
    const entry = this.state.get<CachedEntry>(`${CACHE_PREFIX_DANGER}${hash}`);
    return entry?.text;
  }

  async setCachedDangerNote(hash: string, text: string): Promise<void> {
    await this.state.update(`${CACHE_PREFIX_DANGER}${hash}`, {
      text,
      timestamp: Date.now(),
    } satisfies CachedEntry);
  }

  // ── Clear ───────────────────────────────────────────────────────────────────

  /**
   * Clear all Docent cache entries. Called by the "Refresh Explanations" command.
   */
  async clearAll(): Promise<void> {
    const keys = this.state.keys();
    const docentKeys = keys.filter((k) =>
      k.startsWith('docent.cache.')
    );
    await Promise.all(docentKeys.map((k) => this.state.update(k, undefined)));
  }
}
