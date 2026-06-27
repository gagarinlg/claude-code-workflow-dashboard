// @ts-check
import * as esbuild from 'esbuild';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENTRY = resolve(__dirname, 'src/extension.ts');
const OUTFILE = resolve(__dirname, 'dist/extension.js');

if (!existsSync(ENTRY)) {
  // Fail loudly if src/extension.ts is absent — a silent exit(0) would let
  // vsce package proceed and fail later with a cryptic "main entry not found"
  // error instead of pointing here. M0 made src/extension.ts permanent.
  console.error('Error: src/extension.ts not found. Check for a bad merge or misconfigured include paths.');
  process.exit(1);
}

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: [ENTRY],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
  outfile: OUTFILE,
  minify: !watch,
  // Production builds omit source maps. Shipping 'external' maps would improve
  // Extension Host stack traces but adds ~2× bundle size to the VSIX. This is a
  // conscious trade-off; revisit if minified crash reports become a maintenance
  // burden.
  sourcemap: watch ? 'inline' : false,
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('Watching for changes…');
} else {
  await esbuild.build(buildOptions);
  console.log('Build complete → dist/extension.js');
}
