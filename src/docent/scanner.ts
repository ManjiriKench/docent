/**
 * scanner.ts — Static repo analysis.
 *
 * Reads package.json (or equivalent manifests), top-level folder
 * structure, and README.md without touching the network or git.
 * The output is a RepoContext object used by both the LLM client
 * and the static fallback renderer.
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ManifestInfo {
  name: string;
  description: string;
  version: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  raw: Record<string, unknown>;
}

export interface FolderEntry {
  name: string;
  isDirectory: boolean;
  children?: FolderEntry[];
}

export interface RepoContext {
  rootPath: string;
  manifest: ManifestInfo | null;
  folderStructure: FolderEntry[];
  readmeSummary: string;
  fileExtensionBreakdown: Record<string, number>;
  totalFiles: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Directories that are always ignored during folder scan. */
const ALWAYS_IGNORE = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.next',
  '__pycache__',
  '.venv',
  'venv',
  '.DS_Store',
  'coverage',
  '.nyc_output',
  'dist-test',
]);

const MANIFEST_FILES = [
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
];

// ── RepoScanner ──────────────────────────────────────────────────────────────

export class RepoScanner {
  constructor(private readonly rootPath: string) {}

  /**
   * Run the full static analysis and return a RepoContext.
   */
  async buildContext(): Promise<RepoContext> {
    const [manifest, folderStructure, readmeSummary] = await Promise.all([
      this.scanManifest(),
      this.scanFolderStructure(2),
      this.scanReadme(),
    ]);

    const { breakdown, total } = this.countFileExtensions();

    return {
      rootPath: this.rootPath,
      manifest,
      folderStructure,
      readmeSummary,
      fileExtensionBreakdown: breakdown,
      totalFiles: total,
    };
  }

  /**
   * Attempt to read and parse the first recognised manifest file.
   */
  async scanManifest(): Promise<ManifestInfo | null> {
    for (const filename of MANIFEST_FILES) {
      const filePath = path.join(this.rootPath, filename);
      if (!fs.existsSync(filePath)) {
        continue;
      }

      try {
        if (filename === 'package.json') {
          const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
          return {
            name: (raw['name'] as string) || path.basename(this.rootPath),
            description: (raw['description'] as string) || '',
            version: (raw['version'] as string) || '0.0.0',
            scripts: (raw['scripts'] as Record<string, string>) || {},
            dependencies: (raw['dependencies'] as Record<string, string>) || {},
            devDependencies: (raw['devDependencies'] as Record<string, string>) || {},
            raw,
          };
        }
        // For other manifest types, do a best-effort name extraction
        const content = fs.readFileSync(filePath, 'utf8');
        const nameMatch = content.match(/^name\s*=\s*["']?([^"'\n\r]+)["']?/m);
        return {
          name: nameMatch?.[1]?.trim() || path.basename(this.rootPath),
          description: '',
          version: '',
          scripts: {},
          dependencies: {},
          devDependencies: {},
          raw: { _raw: content },
        };
      } catch {
        // Malformed manifest — skip gracefully
        continue;
      }
    }

    return null;
  }

  /**
   * Walk the folder tree up to `maxDepth` levels, skipping ignored dirs.
   */
  async scanFolderStructure(maxDepth: number): Promise<FolderEntry[]> {
    return this.walkDir(this.rootPath, maxDepth, 0);
  }

  private walkDir(dirPath: string, maxDepth: number, currentDepth: number): FolderEntry[] {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }

    const result: FolderEntry[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env') {
        // Skip hidden files/dirs (but note .env for presence-checking)
        continue;
      }
      if (ALWAYS_IGNORE.has(entry.name)) {
        continue;
      }

      if (entry.isDirectory()) {
        const children =
          currentDepth < maxDepth - 1
            ? this.walkDir(path.join(dirPath, entry.name), maxDepth, currentDepth + 1)
            : [];
        result.push({ name: entry.name, isDirectory: true, children });
      } else {
        result.push({ name: entry.name, isDirectory: false });
      }
    }

    return result;
  }

  /**
   * Read README.md and return the first ~500 words.
   */
  async scanReadme(): Promise<string> {
    const candidates = ['README.md', 'Readme.md', 'readme.md', 'README.MD'];
    for (const name of candidates) {
      const p = path.join(this.rootPath, name);
      if (fs.existsSync(p)) {
        try {
          const content = fs.readFileSync(p, 'utf8');
          return this.extractFirstWords(content, 500);
        } catch {
          return '';
        }
      }
    }
    return '';
  }

  /**
   * Count file extensions across the repo root (non-recursive into ignored dirs).
   */
  private countFileExtensions(): { breakdown: Record<string, number>; total: number } {
    const breakdown: Record<string, number> = {};
    let total = 0;

    const walk = (dirPath: string, depth: number): void => {
      if (depth > 4) {
        return;
      }
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (ALWAYS_IGNORE.has(entry.name)) {
          continue;
        }
        if (entry.isDirectory()) {
          walk(path.join(dirPath, entry.name), depth + 1);
        } else {
          total++;
          const ext = path.extname(entry.name).toLowerCase() || '(no ext)';
          breakdown[ext] = (breakdown[ext] || 0) + 1;
        }
      }
    };

    walk(this.rootPath, 0);
    return { breakdown, total };
  }

  private extractFirstWords(text: string, maxWords: number): string {
    const words = text.split(/\s+/).filter(Boolean);
    return words.slice(0, maxWords).join(' ');
  }

  /**
   * Helper: format the repo context as a compact string for the LLM prompt.
   */
  static formatForPrompt(ctx: RepoContext): string {
    const lines: string[] = [];

    if (ctx.manifest) {
      lines.push(`Project: ${ctx.manifest.name} v${ctx.manifest.version}`);
      if (ctx.manifest.description) {
        lines.push(`Description: ${ctx.manifest.description}`);
      }
      const deps = Object.keys(ctx.manifest.dependencies);
      if (deps.length > 0) {
        lines.push(`Top dependencies: ${deps.slice(0, 8).join(', ')}`);
      }
      const scripts = Object.keys(ctx.manifest.scripts);
      if (scripts.length > 0) {
        lines.push(`Scripts: ${scripts.slice(0, 6).join(', ')}`);
      }
    } else {
      lines.push(`Project: ${path.basename(ctx.rootPath)} (no manifest found)`);
    }

    lines.push(`\nTop-level structure (${ctx.totalFiles} total files):`);
    for (const entry of ctx.folderStructure.slice(0, 20)) {
      if (entry.isDirectory) {
        const childCount = entry.children?.length ?? 0;
        lines.push(`  📁 ${entry.name}/ (${childCount} items)`);
      } else {
        lines.push(`  📄 ${entry.name}`);
      }
    }

    const topExts = Object.entries(ctx.fileExtensionBreakdown)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([ext, count]) => `${ext}(${count})`)
      .join(', ');
    if (topExts) {
      lines.push(`\nFile types: ${topExts}`);
    }

    if (ctx.readmeSummary) {
      lines.push(`\nREADME excerpt:\n${ctx.readmeSummary.slice(0, 800)}`);
    }

    return lines.join('\n');
  }
}
