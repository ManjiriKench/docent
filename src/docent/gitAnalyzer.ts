/**
 * gitAnalyzer.ts — simple-git wrapper + danger-zone logic.
 *
 * All git interaction is done through the simple-git library.
 * If no .git folder exists, every method returns safe empty defaults.
 */

import * as path from 'path';
import simpleGit, { SimpleGit, DefaultLogFields, LogResult } from 'simple-git';

// ── Types ────────────────────────────────────────────────────────────────────

export interface GitContext {
  isGitRepo: boolean;
  totalCommits: number;
  contributors: ContributorInfo[];
  fileChurnMap: Map<string, number>;
  dangerZones: DangerZone[];
  recentActivity: RecentActivity[];
}

export interface ContributorInfo {
  name: string;
  email: string;
  commitCount: number;
}

export interface DangerZone {
  filePath: string;
  commitCount: number;
  reason: string;
  hasReverts: boolean;
}

export interface RecentActivity {
  filePath: string;
  lastCommitMessage: string;
  lastCommitDate: string;
  author: string;
}

// ── GitAnalyzer ──────────────────────────────────────────────────────────────

export class GitAnalyzer {
  private readonly git: SimpleGit;
  private readonly rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
    this.git = simpleGit(rootPath);
  }

  /**
   * Check whether the workspace root is actually a git repository.
   * Returns false (never throws) so the extension gracefully degrades.
   */
  async isGitRepo(): Promise<boolean> {
    try {
      await this.git.status();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Full analysis — returns a GitContext.
   * Safe to call even on non-git directories (returns empty GitContext).
   */
  async buildContext(): Promise<GitContext> {
    const isRepo = await this.isGitRepo();
    if (!isRepo) {
      return {
        isGitRepo: false,
        totalCommits: 0,
        contributors: [],
        fileChurnMap: new Map(),
        dangerZones: [],
        recentActivity: [],
      };
    }

    const [totalCommits, contributors, fileChurnMap] = await Promise.all([
      this.getCommitCount(),
      this.getContributors(),
      this.getFileChurnMap(),
    ]);

    const dangerZones = this.computeDangerZones(fileChurnMap, 0.1);
    const recentActivity = await this.getRecentActivity(10);

    return {
      isGitRepo: true,
      totalCommits,
      contributors,
      fileChurnMap,
      dangerZones,
      recentActivity,
    };
  }

  /**
   * Total number of commits in the repo's main branch history.
   */
  async getCommitCount(): Promise<number> {
    try {
      const countStr = await this.git.raw(['rev-list', '--count', 'HEAD']);
      const count = parseInt(countStr.trim(), 10);
      return isNaN(count) ? 0 : count;
    } catch {
      try {
        const log = await this.git.log();
        return log.total;
      } catch {
        return 0;
      }
    }
  }

  /**
   * Contributors sorted by commit count (descending).
   */
  async getContributors(): Promise<ContributorInfo[]> {
    try {
      // git shortlog -sne --no-merges
      const raw = await this.git.raw(['shortlog', '-sne', '--no-merges', 'HEAD']);
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const match = line.match(/^\s*(\d+)\s+(.+?)\s+<(.+?)>/);
          if (!match) {
            return null;
          }
          return {
            commitCount: parseInt(match[1], 10),
            name: match[2].trim(),
            email: match[3].trim(),
          };
        })
        .filter((c): c is ContributorInfo => c !== null)
        .sort((a, b) => b.commitCount - a.commitCount);
    } catch {
      return [];
    }
  }

  /**
   * Map of { relativeFilePath → commitCount }.
   * Counts how many commits touched each file.
   */
  async getFileChurnMap(): Promise<Map<string, number>> {
    const churnMap = new Map<string, number>();
    try {
      // git log --name-only --pretty=format: HEAD  (list files touched per commit)
      const raw = await this.git.raw(['log', '--name-only', '--pretty=format:', 'HEAD']);
      const lines = raw.split('\n').filter(Boolean);
      for (const line of lines) {
        if (line.trim() === '') {
          continue;
        }
        const normalised = line.trim().replace(/\\/g, '/');
        churnMap.set(normalised, (churnMap.get(normalised) || 0) + 1);
      }
    } catch {
      // If history is empty or git fails, return empty map
    }
    return churnMap;
  }

  /**
   * Given a churn map, return files in the top `percentile` by commit count,
   * plus any files with "revert" in commits touching them.
   */
  computeDangerZones(
    fileChurnMap: Map<string, number>,
    topPercentile: number
  ): DangerZone[] {
    if (fileChurnMap.size === 0) {
      return [];
    }

    const sorted = Array.from(fileChurnMap.entries()).sort(([, a], [, b]) => b - a);
    const cutoffIdx = Math.max(1, Math.ceil(sorted.length * topPercentile));
    const topFiles = sorted.slice(0, cutoffIdx);

    const averageChurn =
      sorted.reduce((sum, [, c]) => sum + c, 0) / sorted.length;

    return topFiles
      .filter(([, count]) => count > averageChurn) // must be above average too
      .map(([filePath, commitCount]) => ({
        filePath,
        commitCount,
        reason: this.buildDangerReason(filePath, commitCount, sorted.length),
        hasReverts: false, // enriched below if revert-scan is run
      }));
  }

  /**
   * Scan git log for commits with "revert" in the message and flag the
   * files they touched. Merges flags into existing DangerZone entries.
   */
  async enrichWithRevertInfo(dangerZones: DangerZone[]): Promise<DangerZone[]> {
    try {
      const log: LogResult<DefaultLogFields> = await this.git.log([
        '--all',
        '--oneline',
        '--grep=revert',
        '-i',
        '--name-only',
        '--pretty=format:%s',
      ]);

      // Parse raw output to find reverted files
      const raw = await this.git.raw([
        'log',
        '--all',
        '--grep=revert',
        '-i',
        '--name-only',
        '--pretty=format:',
      ]);
      const revertedFiles = new Set(
        raw.split('\n').filter(Boolean).map((l) => l.trim().replace(/\\/g, '/'))
      );

      return dangerZones.map((dz) => ({
        ...dz,
        hasReverts: revertedFiles.has(dz.filePath),
        reason: revertedFiles.has(dz.filePath)
          ? `${dz.reason} (has been reverted at least once)`
          : dz.reason,
      }));
    } catch {
      return dangerZones;
    }
  }

  /**
   * Most recently changed files with their last commit info.
   */
  async getRecentActivity(limit: number): Promise<RecentActivity[]> {
    try {
      const log = await this.git.log({
        '--name-only': null,
        '--diff-filter': 'ACDMRT',
        '--pretty': 'format:%H|%s|%ai|%an',
        maxCount: limit * 3, // overfetch to account for duplicates
      } as Parameters<typeof this.git.log>[0]);

      const seen = new Set<string>();
      const result: RecentActivity[] = [];

      for (const commit of log.all) {
        const entry = commit as unknown as DefaultLogFields & { diff?: { files: { file: string }[] } };
        const filePath = entry.diff?.files?.[0]?.file;
        if (!filePath || seen.has(filePath)) {
          continue;
        }
        seen.add(filePath);
        result.push({
          filePath: filePath.replace(/\\/g, '/'),
          lastCommitMessage: entry.message,
          lastCommitDate: entry.date,
          author: entry.author_name,
        });
        if (result.length >= limit) {
          break;
        }
      }

      return result;
    } catch {
      return [];
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private buildDangerReason(filePath: string, commitCount: number, totalFiles: number): string {
    const filename = path.basename(filePath);
    if (commitCount > 50) {
      return `${filename} has been touched ${commitCount} times — it's either very important or perpetually on fire.`;
    }
    if (commitCount > 20) {
      return `${filename} accounts for a disproportionate share of the commit history. Worth understanding before you touch it.`;
    }
    return `${filename} sits in the top ${Math.round((1 / totalFiles) * 100)}% of files by commit frequency. Tread carefully.`;
  }

  /**
   * Serialise a GitContext for LLM prompt injection.
   * Strips the Map (not JSON-serialisable) into a plain array.
   */
  static formatForPrompt(ctx: GitContext): string {
    if (!ctx.isGitRepo) {
      return 'No git history found for this repository.';
    }

    const lines: string[] = [];
    lines.push(`Git history: ${ctx.totalCommits} commits`);

    if (ctx.contributors.length > 0) {
      const contribSummary = ctx.contributors
        .slice(0, 5)
        .map((c) => `${c.name} (${c.commitCount} commits)`)
        .join(', ');
      lines.push(`Contributors: ${contribSummary}`);
    }

    if (ctx.dangerZones.length > 0) {
      lines.push('\nHigh-churn files (flagged as danger zones):');
      for (const dz of ctx.dangerZones.slice(0, 5)) {
        lines.push(`  ⚠️  ${dz.filePath} — ${dz.commitCount} commits${dz.hasReverts ? ', has been reverted' : ''}`);
      }
    }

    return lines.join('\n');
  }
}
