import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Allow .ts file resolution without explicit extension for all test imports.
    // Originally added for erika-m2-verification.test.ts, which now uses ESM imports;
    // retained to ensure Vitest's transform pipeline resolves .ts files consistently.
    extensions: ['.ts', '.js', '.mjs', '.cjs', '.json'],
  },
  test: {
    environment: 'node',
    setupFiles: ['test/setup-require-ts.ts'],
    server: {
      deps: {
        // Inline src/ so vite-node's transformed require() can resolve .ts files
        // when tests use require() for soft-import boundary testing.
        inline: [/^(?!.*node_modules)/],
      },
    },
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/data/**', 'src/webview/**', 'src/export/**'],
      thresholds: {
        perFile: true,
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
});
