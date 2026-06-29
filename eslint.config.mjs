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
  // Apply security rules to build scripts and utility scripts (.mjs).
  // These files use @ts-check for editor-level type inference but are not
  // compiled by tsc, so typescript-eslint rules are not applied — only base ESLint.
  // The security plugin is included here because scripts contain path construction,
  // rmSync, and dynamic imports that warrant static security analysis, even without
  // TypeScript type information. The same two high-noise rules are suppressed here
  // for the same reasons as in the TS block: every non-literal path in scripts is
  // intentional (fixture paths from os.tmpdir()) and bracket notation is used for
  // CSS custom property enumeration (Object.entries(vars)).
  {
    files: ['*.mjs', 'scripts/**/*.mjs'],
    plugins: { security },
    rules: {
      ...security.configs.recommended.rules,
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
    },
  },
);
