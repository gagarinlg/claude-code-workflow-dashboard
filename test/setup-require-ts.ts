/**
 * Vitest setup file: register a Node.js CJS require() extension hook so that
 * require('../src/export/markdown') resolves to markdown.ts.
 *
 * This is needed by erika-m2-verification.test.ts which uses require() as a
 * "soft import" pattern (wrapped in try/catch) to test that buildExportFilename
 * is exported from the markdown module. Without this hook, Node's CJS loader
 * cannot resolve paths without an explicit .ts extension.
 *
 * The hook compiles the TypeScript source on the fly using esbuild's synchronous
 * transform (already a dev dependency). This is a test-only concern and does NOT
 * affect the build or production bundle.
 */

import Module from 'module';
import * as fs from 'fs';
import { transformSync } from 'esbuild';

const extensions = (Module as unknown as { _extensions: Record<string, (m: NodeModule, filename: string) => void> })._extensions;

// Register .ts handler for Node's CJS require(): compile via esbuild and eval.
if (!extensions['.ts']) {
  extensions['.ts'] = function (m: NodeModule, filename: string) {
    const src = fs.readFileSync(filename, 'utf8');
    const result = transformSync(src, {
      loader: 'ts',
      format: 'cjs',
      // Suppress type-only imports/exports (esbuild tsconfigRaw type is loose).
      tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: false } } as Record<string, unknown>,
    });
    (m as unknown as { _compile: (code: string, filename: string) => void })._compile(result.code, filename);
  };
}

// Also teach Node to try .ts extension when resolving extensionless paths.
// This patches Module._resolveFilename to append .ts when the base path fails.
const origResolve = (Module as unknown as { _resolveFilename: (request: string, parent: NodeModule | null, isMain: boolean, options?: object) => string })._resolveFilename;
(Module as unknown as { _resolveFilename: typeof origResolve })._resolveFilename = function (request, parent, isMain, options) {
  try {
    return origResolve(request, parent, isMain, options);
  } catch (e) {
    // Try appending .ts extension
    try {
      return origResolve(request + '.ts', parent, isMain, options);
    } catch {
      throw e;
    }
  }
};
