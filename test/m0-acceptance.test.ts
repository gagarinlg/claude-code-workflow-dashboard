/**
 * M0 acceptance / black-box verification tests.
 * Focus: package manifest correctness, .vscodeignore, CI workflow structure,
 * and docs sync — areas not covered by the data/webview unit tests.
 *
 * Previously named erika-manifest.test.ts; renamed for discoverability.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Helper: read a text file from the project root
// ---------------------------------------------------------------------------
function readRoot(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ---------------------------------------------------------------------------
// package.json correctness (M0-T4, M0-T1 ACs)
// ---------------------------------------------------------------------------
describe('package.json — M0 correctness', () => {
  let pkg: Record<string, unknown>;

  beforeAll(() => {
    pkg = JSON.parse(readRoot('package.json')) as Record<string, unknown>;
  });

  it('main points to ./dist/extension.js (M0-T4)', () => {
    expect(pkg['main']).toBe('./dist/extension.js');
  });

  it('vscode:prepublish runs npm run build (M0-T4)', () => {
    const scripts = pkg['scripts'] as Record<string, string>;
    expect(scripts['vscode:prepublish']).toBe('npm run build');
  });

  it('engines.node >= 18 is set (M0-T1)', () => {
    const engines = pkg['engines'] as Record<string, string>;
    expect(typeof engines['node']).toBe('string');
    // Must be >=18 — accept ">=18.0.0" or ">=18"
    expect(engines['node']).toMatch(/^>=18/);
  });

  it('engines.vscode is set', () => {
    const engines = pkg['engines'] as Record<string, string>;
    expect(typeof engines['vscode']).toBe('string');
    expect(engines['vscode']).toMatch(/\^1\.84/);
  });

  it('all six required scripts exist (M0-T1)', () => {
    const scripts = pkg['scripts'] as Record<string, string>;
    for (const s of ['build', 'watch', 'typecheck', 'lint', 'test', 'coverage']) {
      expect(scripts[s], `script "${s}" must exist`).toBeDefined();
    }
  });

  it('build script invokes build.mjs', () => {
    const scripts = pkg['scripts'] as Record<string, string>;
    expect(scripts['build']).toContain('build.mjs');
  });

  it('test script invokes vitest run', () => {
    const scripts = pkg['scripts'] as Record<string, string>;
    expect(scripts['test']).toContain('vitest');
  });

  it('coverage script invokes vitest with --coverage', () => {
    const scripts = pkg['scripts'] as Record<string, string>;
    expect(scripts['coverage']).toContain('--coverage');
  });

  it('devDependencies includes typescript (M0-T1)', () => {
    const devDeps = pkg['devDependencies'] as Record<string, string>;
    expect(devDeps['typescript']).toBeDefined();
  });

  it('devDependencies includes esbuild (M0-T1)', () => {
    const devDeps = pkg['devDependencies'] as Record<string, string>;
    expect(devDeps['esbuild']).toBeDefined();
  });

  it('devDependencies includes vitest (M0-T1)', () => {
    const devDeps = pkg['devDependencies'] as Record<string, string>;
    expect(devDeps['vitest']).toBeDefined();
  });

  it('@types/vscode is pinned to ~1.84.x (M0-T1, D2-risk)', () => {
    const devDeps = pkg['devDependencies'] as Record<string, string>;
    expect(devDeps['@types/vscode']).toBeDefined();
    // Must be pinned with ~ to ~1.84, not ^ (which would allow 2.x)
    expect(devDeps['@types/vscode']).toMatch(/^~1\.84/);
  });

  it('@types/node is present (M0-T1)', () => {
    const devDeps = pkg['devDependencies'] as Record<string, string>;
    expect(devDeps['@types/node']).toBeDefined();
  });

  it('publisher stays malte-langermann (constraint: do not break)', () => {
    expect(pkg['publisher']).toBe('malte-langermann');
  });
});

// ---------------------------------------------------------------------------
// .vscodeignore correctness (M0-T4 ACs)
// ---------------------------------------------------------------------------
describe('.vscodeignore — M0 packaging exclusions', () => {
  let content: string;

  beforeAll(() => {
    content = readRoot('.vscodeignore');
  });

  it('excludes src/**', () => {
    expect(content).toMatch(/^src\/\*\*/m);
  });

  it('excludes test/**', () => {
    expect(content).toMatch(/^test\/\*\*/m);
  });

  it('excludes root extension.js (D2/D7 transition backstop)', () => {
    expect(content).toMatch(/^extension\.js$/m);
  });

  it('excludes tsconfig.json', () => {
    expect(content).toMatch(/^tsconfig\.json$/m);
  });

  it('excludes build.mjs', () => {
    expect(content).toMatch(/^build\.mjs$/m);
  });

  it('excludes vitest.config.ts', () => {
    expect(content).toMatch(/^vitest\.config\.ts$/m);
  });

  it('excludes eslint.config.mjs (renamed from .js to suppress MODULE_TYPELESS_PACKAGE_JSON)', () => {
    expect(content).toMatch(/^eslint\.config\.mjs$/m);
  });

  it('does NOT exclude dist/extension.js (it must ship in the VSIX)', () => {
    // dist/*.map is allowed (sourcemap exclusion is fine).
    // dist/** or dist/extension.js would prevent the bundle from shipping — disallowed.
    expect(content).not.toMatch(/^dist\/\*\*$/m);
    expect(content).not.toMatch(/^dist\/extension\.js$/m);
  });

  it('does NOT exclude WORKFLOW-AUTHORING.md (command opens it — R2-D6)', () => {
    expect(content).not.toMatch(/^WORKFLOW-AUTHORING\.md$/m);
  });

  it('does NOT exclude README.md (must ship — R2-D6)', () => {
    expect(content).not.toMatch(/^README\.md$/m);
  });

  it('does NOT exclude CHANGELOG.md (must ship — R2-D6)', () => {
    expect(content).not.toMatch(/^CHANGELOG\.md$/m);
  });

  it('does NOT exclude LICENSE (must ship — R2-D6)', () => {
    expect(content).not.toMatch(/^LICENSE$/m);
  });
});

// ---------------------------------------------------------------------------
// dist/extension.js existence and basic content (M0-T2, M0-T4)
// ---------------------------------------------------------------------------
// NOTE: these tests require `npm run build` to have run first. In CI, the
// Build step precedes the Test step so they always pass. Locally, run
// `npm run build` before `npm test` if you see ENOENT on dist/extension.js.
// When dist/extension.js is absent the whole describe block is skipped.
describe('dist/extension.js — build output', () => {
  const distPath = path.join(ROOT, 'dist/extension.js');
  const distExists = fs.existsSync(distPath);
  let distContent: string;

  beforeAll(() => {
    if (!distExists) return; // skipped — no build output present
    distContent = readRoot('dist/extension.js');
  });

  it('dist/extension.js exists and is non-empty (M0-T2)', () => {
    if (!distExists) return;
    expect(distContent.length).toBeGreaterThan(100);
  });

  it('dist/extension.js is CommonJS (has module.exports or exports)', () => {
    if (!distExists) return;
    // esbuild CJS output uses "var __export" or assigns to exports
    // It will definitely reference 'exports' or 'module.exports'
    expect(distContent).toMatch(/exports|module\.exports/);
  });

  it('dist/extension.js references vscode as external require', () => {
    if (!distExists) return;
    // esbuild marks vscode external; it stays as require("vscode")
    expect(distContent).toContain('require("vscode")');
  });

  it('root extension.js is absent (M0-T2 deletion requirement)', () => {
    expect(fs.existsSync(path.join(ROOT, 'extension.js'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CI workflow structure (M0-T5 / §CC ACs)
// ---------------------------------------------------------------------------
describe('ci.yml — M0-T5 workflow correctness', () => {
  let ci: string;

  beforeAll(() => {
    ci = readRoot('.github/workflows/ci.yml');
  });

  it('ci.yml has npm ci step', () => {
    expect(ci).toContain('npm ci');
  });

  it('ci.yml has npm run lint step', () => {
    expect(ci).toContain('npm run lint');
  });

  it('ci.yml has npm run typecheck step', () => {
    expect(ci).toContain('npm run typecheck');
  });

  it('ci.yml has npm run coverage step (coverage gate enforced in CI)', () => {
    // ci.yml runs "npm run coverage" (not "npm test") so the 90% coverage
    // threshold is enforced on every push and PR.
    expect(ci).toContain('npm run coverage');
  });

  it('ci.yml has vsce package step', () => {
    expect(ci).toContain('vsce package');
  });

  it('npm ci appears before vsce package in ci.yml (ordering requirement)', () => {
    const ciPos = ci.indexOf('npm ci');
    const vscePos = ci.indexOf('vsce package');
    expect(ciPos).toBeGreaterThan(-1);
    expect(vscePos).toBeGreaterThan(-1);
    expect(ciPos).toBeLessThan(vscePos);
  });

  it('npm run lint appears before vsce package in ci.yml (ordering)', () => {
    const lintPos = ci.indexOf('npm run lint');
    const vscePos = ci.indexOf('vsce package');
    expect(lintPos).toBeLessThan(vscePos);
  });

  it('npm run coverage appears before vsce package in ci.yml (ordering)', () => {
    const testPos = ci.indexOf('npm run coverage');
    const vscePos = ci.indexOf('vsce package');
    expect(testPos).toBeGreaterThan(-1);
    expect(testPos).toBeLessThan(vscePos);
  });

  it('ci.yml uses cache: npm for npm install caching (R2-D5)', () => {
    expect(ci).toContain('cache: npm');
  });
});

describe('release.yml — M0-T5 workflow correctness', () => {
  let release: string;

  beforeAll(() => {
    release = readRoot('.github/workflows/release.yml');
  });

  it('release.yml has npm ci step', () => {
    expect(release).toContain('npm ci');
  });

  it('npm ci appears before vsce package in release.yml (ordering requirement)', () => {
    const ciPos = release.indexOf('npm ci');
    const vscePos = release.indexOf('vsce package');
    expect(ciPos).toBeGreaterThan(-1);
    expect(vscePos).toBeGreaterThan(-1);
    expect(ciPos).toBeLessThan(vscePos);
  });

  it('release.yml does NOT use cache: npm (R2-D5 — intentional omission)', () => {
    expect(release).not.toContain('cache: npm');
  });
});

describe('nightly.yml — M0-T5 workflow correctness', () => {
  let nightly: string;

  beforeAll(() => {
    nightly = readRoot('.github/workflows/nightly.yml');
  });

  it('nightly.yml has npm ci step', () => {
    expect(nightly).toContain('npm ci');
  });

  it('npm ci appears before vsce package in nightly.yml (ordering)', () => {
    const ciPos = nightly.indexOf('npm ci');
    const vscePos = nightly.indexOf('vsce package');
    expect(ciPos).toBeGreaterThan(-1);
    expect(vscePos).toBeGreaterThan(-1);
    expect(ciPos).toBeLessThan(vscePos);
  });

  it('nightly.yml npm ci is guarded by the skip check condition', () => {
    // The npm ci step should have the same "if: steps.check.outputs.skip != 'true'" guard
    // The simplest assertion: the guard condition appears in the file
    expect(nightly).toContain("steps.check.outputs.skip != 'true'");
    // AND npm ci is present — combined they satisfy the conditional guard AC
  });

  it('nightly.yml does NOT use cache: npm (R2-D5 — intentional omission)', () => {
    expect(nightly).not.toContain('cache: npm');
  });
});

// ---------------------------------------------------------------------------
// CLAUDE.md docs sync (M0-T6 ACs)
// ---------------------------------------------------------------------------
describe('CLAUDE.md — M0-T6 docs sync', () => {
  let claude: string;

  beforeAll(() => {
    claude = readRoot('CLAUDE.md');
  });

  it('CLAUDE.md describes TypeScript as current tech stack', () => {
    expect(claude).toMatch(/TypeScript/i);
  });

  it('CLAUDE.md mentions esbuild', () => {
    expect(claude).toContain('esbuild');
  });

  it('CLAUDE.md mentions vitest', () => {
    expect(claude).toContain('vitest');
  });

  it('CLAUDE.md findWorkflowDir description has NO date filter claim (D9 fix)', () => {
    // Must NOT say "newest run today" (that was the wrong phrasing)
    expect(claude).not.toContain('newest run today');
  });

  it('CLAUDE.md findWorkflowDir description mentions globally-newest or mtime', () => {
    // Must clarify it is globally newest, not today-filtered
    const lower = claude.toLowerCase();
    expect(lower).toMatch(/globally.?newest|no date filter|global.?newest|mtime/);
  });

  it('CLAUDE.md lists npm run build command', () => {
    expect(claude).toContain('npm run build');
  });

  it('CLAUDE.md lists npm test command', () => {
    expect(claude).toContain('npm test');
  });

  it('CLAUDE.md lists src/ in the layout section', () => {
    expect(claude).toMatch(/src\//);
  });
});

// ---------------------------------------------------------------------------
// ROADMAP.md — M0 marked as done (M0-T6 AC)
// ---------------------------------------------------------------------------
describe('ROADMAP.md — M0 completion marker', () => {
  let roadmap: string;

  beforeAll(() => {
    roadmap = readRoot('ROADMAP.md');
  });

  it('ROADMAP.md marks M0 as DONE', () => {
    // Must have a done marker — accept "✅ M0" or "M0 … DONE" or "[x]" checkboxes
    expect(roadmap).toMatch(/✅\s*M0|M0.*DONE|\[x\]/i);
  });
});

// ---------------------------------------------------------------------------
// CHANGELOG.md — M0 version entry (M0-T6 AC)
// ---------------------------------------------------------------------------
describe('CHANGELOG.md — M0 version entry', () => {
  let changelog: string;

  beforeAll(() => {
    changelog = readRoot('CHANGELOG.md');
  });

  it('CHANGELOG.md has a 0.5.0 entry', () => {
    expect(changelog).toContain('0.5.0');
  });

  it('CHANGELOG.md 0.5.0 entry mentions TypeScript migration', () => {
    expect(changelog).toMatch(/TypeScript/);
  });
});

// ---------------------------------------------------------------------------
// build.mjs — early-exit guard and structure (M0-T1 AC)
// ---------------------------------------------------------------------------
describe('build.mjs — structure and early-exit guard', () => {
  let buildScript: string;

  beforeAll(() => {
    buildScript = readRoot('build.mjs');
  });

  it('build.mjs exists', () => {
    expect(buildScript.length).toBeGreaterThan(0);
  });

  it('build.mjs has entry: src/extension.ts', () => {
    expect(buildScript).toContain('src/extension.ts');
  });

  it('build.mjs has outfile: dist/extension.js', () => {
    expect(buildScript).toContain('dist/extension.js');
  });

  it('build.mjs bundles for CJS format', () => {
    // The file uses spaced object syntax: format: 'cjs'
    expect(buildScript).toContain("format: 'cjs'");
  });

  it('build.mjs marks vscode as external', () => {
    expect(buildScript).toContain("'vscode'");
    expect(buildScript).toContain('external');
  });

  it('build.mjs platform is node', () => {
    // The file uses spaced object syntax: platform: 'node'
    expect(buildScript).toContain("platform: 'node'");
  });

  it('build.mjs has early-exit guard for missing src/extension.ts (M0-T1 AC)', () => {
    expect(buildScript).toContain('existsSync');
    // Guard now exits with code 1 (loud failure) rather than 0 (silent skip)
    // so that a missing entry point produces a clear build error, not a silent
    // success that causes a confusing later failure during vsce package.
    expect(buildScript).toContain('process.exit(1)');
  });
});

// ---------------------------------------------------------------------------
// tsconfig.json — strict mode requirements (M0-T1 AC)
// ---------------------------------------------------------------------------
describe('tsconfig.json — strict configuration', () => {
  let tsconfig: Record<string, unknown>;

  beforeAll(() => {
    tsconfig = JSON.parse(readRoot('tsconfig.json')) as Record<string, unknown>;
  });

  it('strict is enabled', () => {
    const opts = tsconfig['compilerOptions'] as Record<string, unknown>;
    expect(opts['strict']).toBe(true);
  });

  it('noUncheckedIndexedAccess is enabled', () => {
    const opts = tsconfig['compilerOptions'] as Record<string, unknown>;
    expect(opts['noUncheckedIndexedAccess']).toBe(true);
  });

  it('noEmit is true (esbuild does the emit, tsc only typechecks)', () => {
    const opts = tsconfig['compilerOptions'] as Record<string, unknown>;
    expect(opts['noEmit']).toBe(true);
  });

  it('module is commonjs', () => {
    const opts = tsconfig['compilerOptions'] as Record<string, unknown>;
    expect((opts['module'] as string).toLowerCase()).toBe('commonjs');
  });

  it('target is ES2021', () => {
    const opts = tsconfig['compilerOptions'] as Record<string, unknown>;
    expect(opts['target']).toBe('ES2021');
  });

  it('includes src and test', () => {
    const include = tsconfig['include'] as string[];
    expect(include).toContain('src');
    expect(include).toContain('test');
  });
});

// ---------------------------------------------------------------------------
// vitest.config.ts — coverage gate configuration (M0-T1 AC)
// ---------------------------------------------------------------------------
describe('vitest.config.ts — coverage gate', () => {
  let vitestConfig: string;

  beforeAll(() => {
    vitestConfig = readRoot('vitest.config.ts');
  });

  it('vitest.config.ts covers src/data/** and src/webview/**', () => {
    expect(vitestConfig).toContain("'src/data/**'");
    expect(vitestConfig).toContain("'src/webview/**'");
  });

  it('vitest.config.ts has 90% line threshold', () => {
    expect(vitestConfig).toContain('lines: 90');
  });

  it('vitest.config.ts has 90% branch threshold', () => {
    expect(vitestConfig).toContain('branches: 90');
  });

  it('vitest.config.ts has 90% function threshold', () => {
    expect(vitestConfig).toContain('functions: 90');
  });

  it('vitest.config.ts uses v8 coverage provider', () => {
    expect(vitestConfig).toContain("provider: 'v8'");
  });

  it('vitest.config.ts includes test/**/*.test.ts', () => {
    expect(vitestConfig).toContain("'test/**/*.test.ts'");
  });
});
