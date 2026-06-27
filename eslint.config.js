// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Apply typescript-eslint recommended rules only to src/ and test/ TypeScript files.
  // Exits 0 when those directories don't exist yet (pre-M0-T2).
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    extends: tseslint.configs.recommended,
  },
);
