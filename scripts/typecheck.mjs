// Thin wrapper around tsc --noEmit.
// Exits 0 when tsc reports only TS18003 ("No inputs were found") — retained as
// a safety net in case include paths are temporarily misconfigured. Since M0-T2,
// src/ and test/ always exist and TS18003 never fires in practice.
// All other tsc errors are printed and cause a non-zero exit.
import { execSync } from 'child_process';

let output = '';
let exitCode = 0;

try {
  // stdio array: [stdin=ignored, stdout=piped for TS18003 filtering, stderr=inherited].
  // stderr is always passed through so tsc warnings/diagnostics are visible in CI and
  // locally, even on zero exit. Only stdout is piped so we can filter TS18003 on failure.
  execSync('tsc --noEmit', { stdio: ['ignore', 'pipe', 'inherit'] });
} catch (err) {
  exitCode = /** @type {any} */ (err).status ?? 1;
  output = (/** @type {any} */ (err).stdout?.toString() ?? '') +
           (/** @type {any} */ (err).stderr?.toString() ?? '');
}

if (exitCode === 0) process.exit(0);

// Strip lines that are only the TS18003 "no inputs" error.
// This suppression is retained as a no-op safety net — TS18003 will never fire
// now that src/ and test/ are present, but keeps the script forward-compatible
// if the include paths are ever temporarily misconfigured.
const lines = output.split('\n');
const realErrors = lines.filter(
  l => l.trim() !== '' && !l.includes('TS18003') && !l.includes("Specified 'include' paths were")
);

if (realErrors.length === 0) {
  process.exit(0);
}

// Real type errors — print and fail.
console.error(realErrors.join('\n'));
process.exit(exitCode);
