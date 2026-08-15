import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { DocentCache } from '../../docent/cache';
import { GitAnalyzer } from '../../docent/gitAnalyzer';
import { RepoScanner } from '../../docent/scanner';

suite('Docent Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  test('Extension activation registers all docent commands including selectProvider', async () => {
    // Check if docent commands are registered
    const allCommands = await vscode.commands.getCommands(true);
    assert.ok(allCommands.includes('docent.selectProvider'), 'docent.selectProvider command should be registered');
    assert.ok(allCommands.includes('docent.setApiKey'), 'docent.setApiKey command should be registered');
    assert.ok(allCommands.includes('docent.refreshExplanations'), 'docent.refreshExplanations command should be registered');
    assert.ok(allCommands.includes('docent.openSidebar'), 'docent.openSidebar command should be registered');
  });

  test('LLMClient with local provider isConfigured returns true without API keys', async () => {
    const mockSecrets: vscode.SecretStorage = {
      get: async () => undefined,
      store: async () => {},
      delete: async () => {},
      keys: async () => [],
      onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
    };

    const mockConfig = {
      get: (key: string, defaultValue?: any) => {
        if (key === 'llmProvider') return 'local';
        return defaultValue;
      },
    } as unknown as vscode.WorkspaceConfiguration;

    const { LLMClient } = await import('../../docent/llmClient');
    const client = new LLMClient(mockSecrets, mockConfig);
    const configured = await client.isConfigured();
    assert.strictEqual(configured, true, 'Local provider must be configured without needing cloud API keys');
  });

  test('DocentCache computeHash produces deterministic SHA-256 slice', () => {
    const mockMemento: vscode.Memento = {
      keys: () => [],
      get: <T>(_key: string, defaultValue?: T) => defaultValue as T,
      update: async () => {},
    };

    const cache = new DocentCache(mockMemento);
    const hash1 = cache.computeHash('sample-content', 123456);
    const hash2 = cache.computeHash('sample-content', 123456);
    const hash3 = cache.computeHash('sample-content', 654321);

    assert.strictEqual(hash1, hash2, 'Identical content + mtime must produce identical hash');
    assert.notStrictEqual(hash1, hash3, 'Different mtime must produce different hash');
    assert.strictEqual(hash1.length, 32, 'Hash must be a 32-character string');
  });

  test('GitAnalyzer danger-zone scoring correctly flags top-decile files', () => {
    const analyzer = new GitAnalyzer(__dirname);
    
    const churnMap = new Map<string, number>([
      ['src/core.ts', 100],
      ['src/utils.ts', 45],
      ['src/config.ts', 12],
      ['src/constants.ts', 2],
      ['src/types.ts', 1],
      ['src/index.ts', 1],
      ['src/helpers.ts', 1],
      ['src/logger.ts', 1],
      ['src/styles.css', 1],
      ['src/vendor.js', 1],
    ]);

    const dangerZones = analyzer.computeDangerZones(churnMap, 0.2); // top 20%
    assert.ok(dangerZones.length > 0, 'Should find danger zones');
    assert.strictEqual(dangerZones[0].filePath, 'src/core.ts', 'Top file should be src/core.ts');
    assert.ok(dangerZones[0].commitCount === 100);
    assert.ok(dangerZones[0].reason.includes('core.ts'), 'Reason should mention the file');
  });

  test('GitAnalyzer handles non-git folders gracefully without throwing', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docent-non-git-'));
    try {
      const analyzer = new GitAnalyzer(tempDir);
      const isRepo = await analyzer.isGitRepo();
      assert.strictEqual(isRepo, false, 'Temporary non-git dir should return isGitRepo=false');
      
      const ctx = await analyzer.buildContext();
      assert.strictEqual(ctx.isGitRepo, false);
      assert.strictEqual(ctx.totalCommits, 0);
      assert.strictEqual(ctx.dangerZones.length, 0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('RepoScanner parses package.json and directory structure correctly', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docent-test-repo-'));
    try {
      const pkg = {
        name: 'test-app',
        version: '1.2.3',
        dependencies: { react: '^18.0.0' },
        scripts: { test: 'jest' },
      };
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(pkg));
      fs.mkdirSync(path.join(tempDir, 'src'));
      fs.writeFileSync(path.join(tempDir, 'src', 'index.ts'), 'console.log("hello");');
      fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test App\nA great application for testing Docent.');

      const scanner = new RepoScanner(tempDir);
      const ctx = await scanner.buildContext();

      assert.strictEqual(ctx.manifest?.name, 'test-app');
      assert.strictEqual(ctx.manifest?.version, '1.2.3');
      assert.ok(ctx.manifest?.dependencies['react']);
      assert.ok(ctx.readmeSummary.includes('Test App'));
      assert.strictEqual(ctx.fileExtensionBreakdown['.ts'], 1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
