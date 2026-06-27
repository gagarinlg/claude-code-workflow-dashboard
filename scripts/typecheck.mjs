// Thin wrapper around tsc --noEmit.
// Exits 0 when tsc reports only TS18003 ("No inputs were found") — which is
// expected pre-M0-T2 while src/ and test/ don't exist yet.
// All other tsc errors are printed and cause a non-zero exit.
import { execSync } from 'child_process';

let output = '';
let exitCode = 0;

try {
  execSync('tsc --noEmit', { stdio: ['ignore', 'pipe', 'pipe'] });
} catch (err) {
  exitCode = /** @type {any} */ (err).status ?? 1;
  output = (/** @type {any} */ (err).stdout?.toString() ?? '') +
           (/** @type {any} */ (err).stderr?.toString() ?? '');
}

if (exitCode === 0) process.exit(0);

// Strip lines that are only the TS18003 "no inputs" error.
const lines = output.split('\n');
const realErrors = lines.filter(
  l => l.trim() !== '' && !l.includes('TS18003') && !l.includes("Specified 'include' paths were")
);

if (realErrors.length === 0) {
  // Only the TS18003 no-inputs error; tolerate it pre-M0-T2.
  process.exit(0);
}

// Real type errors — print and fail.
console.error(realErrors.join('\n'));
process.exit(exitCode);
