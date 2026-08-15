// @ts-check
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const baseConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: !production,
  minify: production,
  metafile: true,
  logLevel: 'info',
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(baseConfig);
    await ctx.watch();
    console.log('[esbuild] watching for changes…');
  } else {
    const result = await esbuild.build(baseConfig);
    if (result.metafile) {
      const analysis = await esbuild.analyzeMetafile(result.metafile, { verbose: false });
      console.log(analysis);
    }
    console.log('[esbuild] build complete.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
