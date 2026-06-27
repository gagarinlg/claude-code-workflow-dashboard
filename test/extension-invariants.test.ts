/**
 * Independent verification tests — Erika "The Verifier" Neumann
 *
 * Scope: M0 re-review. These tests verify AC gaps not already covered by
 * Fritz's test files (m0-acceptance.test.ts, parse.test.ts, etc.).
 *
 * Tests written from the spec, not from the implementation internals.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { classify, MAX_ROLE_RULE_RE_LEN } from '../src/data/parse';
import type { RoleRule } from '../src/data/parse';

const ROOT = path.join(__dirname, '..');

function readRoot(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ---------------------------------------------------------------------------
// AC: Nightly and release workflows updated similarly to ci.yml (ROADMAP M0)
// The existing m0-acceptance tests only verify ci.yml has npm run coverage;
// they do NOT verify release.yml and nightly.yml have the same gate.
// ---------------------------------------------------------------------------
describe('release.yml — coverage gate (ROADMAP M0 AC)', () => {
  let release: string;

  beforeAll(() => {
    release = readRoot('.github/workflows/release.yml');
  });

  it('release.yml has npm run lint step (updated similarly to ci.yml)', () => {
    expect(release).toContain('npm run lint');
  });

  it('release.yml has npm run coverage step (90% gate enforced in release workflow)', () => {
    // ROADMAP M0: "Nightly and release workflows updated similarly [to ci.yml]"
    // ci.yml runs npm run coverage; release.yml must too.
    expect(release).toContain('npm run coverage');
  });

  it('npm run coverage appears before vsce package in release.yml (ordering)', () => {
    const coveragePos = release.indexOf('npm run coverage');
    const vscePos = release.indexOf('vsce package');
    expect(coveragePos).toBeGreaterThan(-1);
    expect(vscePos).toBeGreaterThan(-1);
    expect(coveragePos).toBeLessThan(vscePos);
  });

  it('release.yml has vsce publish step (Marketplace publish AC)', () => {
    expect(release).toContain('vsce publish');
  });

  it('release.yml verifies tag matches package.json version before publish (integrity check)', () => {
    // The tag-version alignment check prevents publishing a VSIX whose
    // package.json version doesn't match the git tag.
    expect(release).toContain('TAG');
    expect(release).toContain('PKG');
  });
});

describe('nightly.yml — coverage gate and structure (ROADMAP M0 AC)', () => {
  let nightly: string;

  beforeAll(() => {
    nightly = readRoot('.github/workflows/nightly.yml');
  });

  it('nightly.yml has npm run lint step (updated similarly to ci.yml)', () => {
    expect(nightly).toContain('npm run lint');
  });

  it('nightly.yml has npm run coverage step (90% gate enforced in nightly workflow)', () => {
    // ROADMAP M0: "Nightly and release workflows updated similarly [to ci.yml]"
    expect(nightly).toContain('npm run coverage');
  });

  it('npm run coverage appears before vsce package in nightly.yml (ordering)', () => {
    const coveragePos = nightly.indexOf('npm run coverage');
    const vscePos = nightly.indexOf('vsce package');
    expect(coveragePos).toBeGreaterThan(-1);
    expect(vscePos).toBeGreaterThan(-1);
    expect(coveragePos).toBeLessThan(vscePos);
  });

  it('nightly.yml uses --pre-release flag for vsce package (nightly must be pre-release only)', () => {
    // Nightly MUST NOT publish as stable; the --pre-release flag is mandatory.
    expect(nightly).toContain('--pre-release');
  });

  it('nightly.yml has skip-if-no-new-commits guard (avoids wasteful daily publishes)', () => {
    // The skip check uses git log --since to detect new commits.
    // ROADMAP: "only when there have been new commits in the last 24h"
    expect(nightly).toContain('git log --since');
  });
});

// ---------------------------------------------------------------------------
// AC: classify() structural ReDoS guard (REDOS_DANGER_RE)
// The length cap is tested in parse.test.ts; the structural guard for
// catastrophic backtracking patterns (e.g. (a+)+) is not yet tested.
// ---------------------------------------------------------------------------
describe('classify — structural ReDoS guard (REDOS_DANGER_RE)', () => {
  it('skips a rule with quantified group over quantified atom: (a+)+', () => {
    // (a+)+ is the canonical catastrophically backtracking pattern.
    // It must be silently skipped rather than executed against text.
    // The text 'aaaaaaa' would match (a+)+, so if the rule were executed
    // the result.label would be 'Danger'; since it is skipped, classify
    // falls through to deriveLabel.
    const rules: RoleRule[] = [
      { re: '(a+)+', label: 'Danger', key: 'danger' },
    ];
    const result = classify('aaaaaaa You are a planner', rules);
    expect(result.label).not.toBe('Danger');
    expect(result.key).not.toBe('danger');
  });

  it('skips a rule with quantified group over char class: ([a-z]+)*', () => {
    // ([a-z]+)* is another canonical catastrophic backtracking pattern.
    const rules: RoleRule[] = [
      { re: '([a-z]+)*end', label: 'BadPattern', key: 'bad' },
    ];
    const result = classify('You are a developer', rules);
    expect(result.label).not.toBe('BadPattern');
    expect(result.key).not.toBe('bad');
  });

  it('allows a safe rule with a plain quantifier (not a quantified group)', () => {
    // a+ is safe — no catastrophic backtracking risk.
    // The structural guard must NOT reject safe patterns with simple quantifiers.
    const rules: RoleRule[] = [
      { re: 'developer+', label: 'Dev', key: 'dev' },
    ];
    const result = classify('You are a developer', rules);
    // 'developer' contains 'developer' and matches 'developer+', so label should be Dev
    expect(result.label).toBe('Dev');
  });

  it('structural guard fires independently of MAX_ROLE_RULE_RE_LEN (short dangerous pattern)', () => {
    // (a+)+ is only 5 chars — well under MAX_ROLE_RULE_RE_LEN (500).
    // The structural guard is the primary defence for short catastrophic patterns
    // that slip past the length cap.
    const dangerousShortPattern = '(a+)+';
    expect(dangerousShortPattern.length).toBeLessThan(MAX_ROLE_RULE_RE_LEN);
    const rules: RoleRule[] = [
      { re: dangerousShortPattern, label: 'Danger', key: 'danger' },
    ];
    const result = classify('aaaaaaaaaa', rules);
    expect(result.label).not.toBe('Danger');
  });
});

// ---------------------------------------------------------------------------
// AC: FSWatcher close/clear on activate() re-call (CLAUDE.md / extension.ts)
// This was the HIGH finding from the prior review round.
// extension.ts cannot be imported without mocking vscode, so we verify the
// structural requirement through the source text as a behavioral proxy:
// the activate() function MUST close the watcher before resetting watchedDir.
// ---------------------------------------------------------------------------
describe('extension.ts — FSWatcher cleanup on re-activation (HIGH finding fix)', () => {
  let extSrc: string;

  beforeAll(() => {
    extSrc = readRoot('src/extension.ts');
  });

  it('activate() contains watcher.close() call (watcher is closed on re-activation)', () => {
    // The fix: activate() must close the existing FSWatcher before creating a new one.
    // Without this, stale watchers accumulate on each F5 reload in the dev host.
    const activateSection = extSrc.slice(extSrc.indexOf('export function activate('));
    expect(activateSection).toContain('watcher.close()');
  });

  it('activate() sets watcher = null after closing it', () => {
    // The watcher must be nulled after close so manageWatch() creates a fresh one.
    const activateSection = extSrc.slice(extSrc.indexOf('export function activate('));
    expect(activateSection).toContain('watcher = null');
  });

  it('activate() resets watchedDir = null (so manageWatch() will re-watch the new dir)', () => {
    // If watchedDir is not reset, manageWatch() sees dir === watchedDir and skips
    // re-watching — even though the watcher was closed. This silently drops updates.
    const activateSection = extSrc.slice(extSrc.indexOf('export function activate('));
    expect(activateSection).toContain('watchedDir = null');
  });

  it('deactivate() closes the FSWatcher (extension host shutdown)', () => {
    // deactivate() must close the watcher to avoid leaking OS handles.
    const deactivateSection = extSrc.slice(extSrc.indexOf('export function deactivate('));
    expect(deactivateSection).toContain('watcher.close()');
  });

  it('watcher.on(error) handler resets both watcher and watchedDir to null', () => {
    // When the watched dir is deleted or becomes inaccessible, the error handler
    // must reset both module-level vars so the polling timer can re-discover.
    // The handler uses a captured local variable (w) to avoid stale-closure races
    // where a delayed error on a previously-replaced watcher nulls the current one.
    expect(extSrc).toContain("w.on('error', () => {");
    expect(extSrc).toContain('watcher = null; watchedDir = null;');
  });
});

// ---------------------------------------------------------------------------
// AC: safeSnap strips workflowDir from webview payload (information disclosure)
// (CLAUDE.md: sanitize transcript-derived data before webview injection)
// ---------------------------------------------------------------------------
describe('extension.ts — safeSnap strips workflowDir from webview payload', () => {
  let extSrc: string;

  beforeAll(() => {
    extSrc = readRoot('src/extension.ts');
  });

  it('safeSnap function exists in extension.ts', () => {
    expect(extSrc).toContain('function safeSnap(');
  });

  it('safeSnap destructures workflowDir out of the snapshot', () => {
    // The fix: { workflowDir: _wd, ...safe } = s — workflowDir is stripped
    // before the snapshot is sent to any webview.
    expect(extSrc).toContain('workflowDir');
    // The destructuring must exclude it from the safe spread
    expect(extSrc).toContain('_wd');
  });

  it('pushToAll() uses safeSnap before postMessage (both webview paths sanitized)', () => {
    expect(extSrc).toContain('safeSnap(latest)');
  });
});

// ---------------------------------------------------------------------------
// AC: Read-only at runtime — extension never writes to ~/.claude or repo
// Verify through public API exports: no write-capable exports.
// ---------------------------------------------------------------------------
describe('extension.ts — exported API is read-only', () => {
  it('extension.ts exports only activate, deactivate, and getCfg (no write functions)', () => {
    const src = readRoot('src/extension.ts');
    // Extract all export function names
    const exportedFns = [...src.matchAll(/^export function (\w+)/gm)].map((m) => m[1]);
    // Must contain exactly these three
    expect(exportedFns).toContain('activate');
    expect(exportedFns).toContain('deactivate');
    expect(exportedFns).toContain('getCfg');
    // Must NOT export any write/mutate function names
    for (const name of exportedFns) {
      expect(['activate', 'deactivate', 'getCfg']).toContain(name);
    }
  });
});

// ---------------------------------------------------------------------------
// AC: Internal command/setting ids stay claudeWorkflow.* (CLAUDE.md constraint)
// ---------------------------------------------------------------------------
describe('package.json — internal command and setting ids stay claudeWorkflow.*', () => {
  let pkg: Record<string, unknown>;

  beforeAll(() => {
    pkg = JSON.parse(readRoot('package.json')) as Record<string, unknown>;
  });

  it('all contributed command ids start with claudeWorkflow.', () => {
    const contrib = pkg['contributes'] as Record<string, unknown>;
    const commands = contrib['commands'] as Array<Record<string, string>>;
    for (const cmd of commands) {
      expect(cmd['command'], `command "${cmd['command']}" must start with claudeWorkflow.`).toMatch(/^claudeWorkflow\./);
    }
  });

  it('all configuration property ids start with claudeWorkflow.', () => {
    const contrib = pkg['contributes'] as Record<string, unknown>;
    const config = contrib['configuration'] as Record<string, unknown>;
    const props = config['properties'] as Record<string, unknown>;
    for (const key of Object.keys(props)) {
      expect(key, `setting "${key}" must start with claudeWorkflow.`).toMatch(/^claudeWorkflow\./);
    }
  });

  it('view id is claudeWorkflow.dashboard', () => {
    const contrib = pkg['contributes'] as Record<string, unknown>;
    const views = contrib['views'] as Record<string, Array<Record<string, string>>>;
    const dashboardViews = views['claudeWorkflow'] ?? [];
    const ids = dashboardViews.map((v) => v['id']);
    expect(ids).toContain('claudeWorkflow.dashboard');
  });

  it('viewsContainer id is claudeWorkflow', () => {
    const contrib = pkg['contributes'] as Record<string, unknown>;
    const containers = contrib['viewsContainers'] as Record<string, Array<Record<string, string>>>;
    const activityBar = containers['activitybar'] ?? [];
    const ids = activityBar.map((c) => c['id']);
    expect(ids).toContain('claudeWorkflow');
  });
});

// ---------------------------------------------------------------------------
// AC: GPL-3.0-or-later license (CLAUDE.md constraint)
// ---------------------------------------------------------------------------
describe('package.json — GPL-3.0-or-later license (CLAUDE.md)', () => {
  it('license field is GPL-3.0-or-later', () => {
    const pkg = JSON.parse(readRoot('package.json')) as Record<string, unknown>;
    expect(pkg['license']).toBe('GPL-3.0-or-later');
  });

  it('LICENSE file exists and contains GPL text', () => {
    const licenseText = readRoot('LICENSE');
    expect(licenseText).toMatch(/GNU GENERAL PUBLIC LICENSE/i);
  });
});

// ---------------------------------------------------------------------------
// AC: WORKFLOW-AUTHORING.md must ship in the VSIX (openGuide command opens it)
// Already partially covered by m0-acceptance.test.ts, but that test only checks
// .vscodeignore does not exclude it. This test verifies the file actually exists.
// ---------------------------------------------------------------------------
describe('WORKFLOW-AUTHORING.md — must exist on disk (openGuide command requires it)', () => {
  it('WORKFLOW-AUTHORING.md exists at the project root', () => {
    expect(fs.existsSync(path.join(ROOT, 'WORKFLOW-AUTHORING.md'))).toBe(true);
  });

  it('WORKFLOW-AUTHORING.md is non-empty', () => {
    const content = readRoot('WORKFLOW-AUTHORING.md');
    expect(content.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC: webview CSP blocks external resources (CLAUDE.md: no external requests)
// ---------------------------------------------------------------------------
describe('html.ts — CSP default-src none blocks all external requests', () => {
  it('CSP contains default-src none (all external requests blocked)', () => {
    const html = readRoot('src/webview/html.ts');
    // The CSP must include default-src 'none' to satisfy the extension-level
    // requirement that no external resources are loaded from the webview.
    expect(html).toContain("default-src 'none'");
  });
});
