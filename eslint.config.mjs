// @ts-check
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';

export default tseslint.config(
  // Apply typescript-eslint recommended rules to src/ and test/ TypeScript files.
  // eslint-plugin-security provides static analysis for common Node.js security
  // patterns (unsafe regex, child_process injection, path injection).
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    extends: tseslint.configs.recommended,
    plugins: { security },
    rules: {
      ...security.configs.recommended.rules,
      // These rules produce unavoidable false positives for this codebase:
      // detect-non-literal-fs-filename fires on every fs.* call with a path
      // variable — all intentional, all from vetted sources (wfDir, cfg.repo).
      // detect-object-injection fires on every bracket access with a string key
      // — all intentional (journal parsing, seen/verdicts maps).
      // Disable to keep signal-to-noise ratio high; keep the higher-value rules.
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
    },
  },
  // Apply basic JS rules to build scripts and utility scripts (.mjs).
  // These files use @ts-check for editor-level type inference but are not
  // compiled by tsc, so typescript-eslint rules are not applied — only base ESLint.
  {
    files: ['*.mjs', 'scripts/**/*.mjs'],
  },
);
