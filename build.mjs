// @ts-check
import * as esbuild from 'esbuild';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENTRY = resolve(__dirname, 'src/extension.ts');
const OUTFILE = resolve(__dirname, 'dist/extension.js');

if (!existsSync(ENTRY)) {
  console.log('src/extension.ts not present yet (pre-M0-T2); skipping build');
  process.exit(0);
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
