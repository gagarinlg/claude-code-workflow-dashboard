/**
 * M4-Community — tests for community scaffolding files.
 *
 * Validates:
 *   1. CONTRIBUTING.md exists and covers required topics:
 *      - npm ci / build / watch / test / lint / typecheck / coverage
 *      - dist/ is generated, not committed
 *      - 90 % coverage gate
 *      - PR flow (branch from master, typecheck+lint+coverage before push)
 *      - code style (read-only, theme-native, no inline style= on innerHTML)
 *   2. SECURITY.md exists and explicitly notes what the extension reads and writes:
 *      - reads ~/.claude transcripts
 *      - writes nothing
 *      - private reporting contact
 *      - supported versions table
 *      - scope (in / out)
 *      - unofficial / not affiliated with Anthropic disclaimer
 *   3. CODE_OF_CONDUCT.md exists and is Contributor Covenant v2.1.
 *   4. .github/ISSUE_TEMPLATE/bug_report.md exists with required fields.
 *   5. .github/ISSUE_TEMPLATE/feature_request.md exists.
 *   6. .github/ISSUE_TEMPLATE/config.yml exists and blocks blank issues.
 *   7. .github/PULL_REQUEST_TEMPLATE.md exists with the required checklist items.
 *   8. All community files are consistent with repo facts:
 *      - publisher: malte-langermann
 *      - repo: gagarinlg
 *      - branch: master
 *      - NOT affiliated with Anthropic
 *      - license: GPL-3.0-or-later (or GPL-3.0)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');

function readFile(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function fileExists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel));
}

// ---------------------------------------------------------------------------
// CONTRIBUTING.md
// ---------------------------------------------------------------------------

describe('M4-Community — CONTRIBUTING.md', () => {
  it('CONTRIBUTING.md exists', () => {
    expect(fileExists('CONTRIBUTING.md')).toBe(true);
  });

  it('covers npm ci (dev setup)', () => {
    expect(readFile('CONTRIBUTING.md')).toContain('npm ci');
  });

  it('covers npm run build', () => {
    expect(readFile('CONTRIBUTING.md')).toContain('npm run build');
  });

  it('covers npm run watch', () => {
    expect(readFile('CONTRIBUTING.md')).toContain('npm run watch');
  });

  it('covers npm test', () => {
    expect(readFile('CONTRIBUTING.md')).toContain('npm test');
  });

  it('covers npm run lint', () => {
    expect(readFile('CONTRIBUTING.md')).toContain('npm run lint');
  });

  it('covers npm run typecheck', () => {
    expect(readFile('CONTRIBUTING.md')).toContain('npm run typecheck');
  });

  it('covers npm run coverage', () => {
    expect(readFile('CONTRIBUTING.md')).toContain('npm run coverage');
  });

  it('mentions screenshots command', () => {
    expect(readFile('CONTRIBUTING.md')).toContain('npm run screenshots');
  });

  it('mentions 90 % coverage gate', () => {
    const c = readFile('CONTRIBUTING.md');
    expect(c).toMatch(/90\s*%/);
  });

  it('explains dist/ is generated, not committed', () => {
    const c = readFile('CONTRIBUTING.md').toLowerCase();
    expect(c).toContain('dist');
    // The key message: dist is generated / not committed
    expect(c).toMatch(/generated|not committed|never commit/);
  });

  it('mentions PR flow — branch from master', () => {
    expect(readFile('CONTRIBUTING.md').toLowerCase()).toContain('master');
  });

  it('mentions code style — read-only', () => {
    expect(readFile('CONTRIBUTING.md').toLowerCase()).toContain('read-only');
  });

  it('mentions theme-native / --vscode- CSS variables', () => {
    const c = readFile('CONTRIBUTING.md');
    expect(c).toMatch(/--vscode-|theme-native/);
  });

  it('mentions no inline style= on innerHTML (CSP)', () => {
    const c = readFile('CONTRIBUTING.md').toLowerCase();
    expect(c).toMatch(/csp|inline.*style|style.*inline|nonce/);
  });

  it('references CODE_OF_CONDUCT.md', () => {
    expect(readFile('CONTRIBUTING.md')).toContain('CODE_OF_CONDUCT.md');
  });

  it('references SECURITY.md', () => {
    expect(readFile('CONTRIBUTING.md')).toContain('SECURITY.md');
  });

  it('is consistent: repo owner is gagarinlg', () => {
    expect(readFile('CONTRIBUTING.md')).toContain('gagarinlg');
  });

  it('contains a link to the GitHub repository', () => {
    expect(readFile('CONTRIBUTING.md')).toContain('github.com/gagarinlg');
  });
});

// ---------------------------------------------------------------------------
// SECURITY.md
// ---------------------------------------------------------------------------

describe('M4-Community — SECURITY.md', () => {
  it('SECURITY.md exists', () => {
    expect(fileExists('SECURITY.md')).toBe(true);
  });

  it('explicitly states the extension reads ~/.claude transcripts', () => {
    const s = readFile('SECURITY.md').toLowerCase();
    expect(s).toMatch(/~\/.claude|claude.*project|transcript/);
  });

  it('explicitly states the extension writes nothing', () => {
    const s = readFile('SECURITY.md').toLowerCase();
    expect(s).toMatch(/writes?\s+nothing|never\s+write|read.?only/);
  });

  it('states no network requests are made', () => {
    const s = readFile('SECURITY.md').toLowerCase();
    expect(s).toMatch(/no.*network|network.*none|never.*network/);
  });

  it('has a supported versions table', () => {
    expect(readFile('SECURITY.md')).toContain('Supported Versions');
  });

  it('includes a private reporting contact', () => {
    const s = readFile('SECURITY.md');
    // Contact email is present
    expect(s).toMatch(/@/);
  });

  it('has an in-scope / out-of-scope section', () => {
    const s = readFile('SECURITY.md').toLowerCase();
    expect(s).toMatch(/in.?scope|out.?of.?scope/);
  });

  it('mentions XSS / webview attack surface', () => {
    const s = readFile('SECURITY.md').toLowerCase();
    expect(s).toMatch(/xss|webview|injection/);
  });

  it('includes unofficial / not affiliated with Anthropic disclaimer', () => {
    const s = readFile('SECURITY.md');
    expect(s).toContain('not affiliated with Anthropic');
  });

  it('mentions response timeline', () => {
    const s = readFile('SECURITY.md').toLowerCase();
    expect(s).toMatch(/response|timeline|business day/);
  });
});

// ---------------------------------------------------------------------------
// CODE_OF_CONDUCT.md — Contributor Covenant v2.1
// ---------------------------------------------------------------------------

describe('M4-Community — CODE_OF_CONDUCT.md', () => {
  it('CODE_OF_CONDUCT.md exists', () => {
    expect(fileExists('CODE_OF_CONDUCT.md')).toBe(true);
  });

  it('references Contributor Covenant', () => {
    const c = readFile('CODE_OF_CONDUCT.md');
    expect(c).toContain('Contributor Covenant');
  });

  it('is version 2.1', () => {
    const c = readFile('CODE_OF_CONDUCT.md');
    expect(c).toContain('2.1');
  });

  it('has Our Pledge section', () => {
    expect(readFile('CODE_OF_CONDUCT.md')).toContain('Our Pledge');
  });

  it('has Our Standards section', () => {
    expect(readFile('CODE_OF_CONDUCT.md')).toContain('Our Standards');
  });

  it('has Enforcement section', () => {
    expect(readFile('CODE_OF_CONDUCT.md')).toContain('Enforcement');
  });

  it('has an enforcement contact', () => {
    // Should have an email address for reporting
    expect(readFile('CODE_OF_CONDUCT.md')).toMatch(/@/);
  });

  it('has Enforcement Guidelines with four levels', () => {
    const c = readFile('CODE_OF_CONDUCT.md');
    expect(c).toContain('Correction');
    expect(c).toContain('Warning');
    expect(c).toContain('Temporary Ban');
    expect(c).toContain('Permanent Ban');
  });

  it('links to the canonical Contributor Covenant URL', () => {
    expect(readFile('CODE_OF_CONDUCT.md')).toContain('contributor-covenant.org');
  });
});

// ---------------------------------------------------------------------------
// .github/ISSUE_TEMPLATE/bug_report.md
// ---------------------------------------------------------------------------

describe('M4-Community — bug_report.md', () => {
  it('.github/ISSUE_TEMPLATE/bug_report.md exists', () => {
    expect(fileExists('.github/ISSUE_TEMPLATE/bug_report.md')).toBe(true);
  });

  it('has GitHub front matter with name and labels', () => {
    const c = readFile('.github/ISSUE_TEMPLATE/bug_report.md');
    expect(c).toContain('name:');
    expect(c).toContain('labels:');
  });

  it('asks for steps to reproduce', () => {
    const c = readFile('.github/ISSUE_TEMPLATE/bug_report.md').toLowerCase();
    expect(c).toMatch(/reproduce|steps/);
  });

  it('asks for expected behavior', () => {
    const c = readFile('.github/ISSUE_TEMPLATE/bug_report.md').toLowerCase();
    expect(c).toContain('expected');
  });

  it('asks for environment / extension version', () => {
    const c = readFile('.github/ISSUE_TEMPLATE/bug_report.md').toLowerCase();
    expect(c).toMatch(/version|environment/);
  });

  it('has a security caution (do not share transcript content)', () => {
    const c = readFile('.github/ISSUE_TEMPLATE/bug_report.md').toLowerCase();
    expect(c).toMatch(/do not share|not share|security|transcript/);
  });
});

// ---------------------------------------------------------------------------
// .github/ISSUE_TEMPLATE/feature_request.md
// ---------------------------------------------------------------------------

describe('M4-Community — feature_request.md', () => {
  it('.github/ISSUE_TEMPLATE/feature_request.md exists', () => {
    expect(fileExists('.github/ISSUE_TEMPLATE/feature_request.md')).toBe(true);
  });

  it('has GitHub front matter with name', () => {
    const c = readFile('.github/ISSUE_TEMPLATE/feature_request.md');
    expect(c).toContain('name:');
  });

  it('asks for the problem / motivation', () => {
    const c = readFile('.github/ISSUE_TEMPLATE/feature_request.md').toLowerCase();
    expect(c).toMatch(/problem|motivation/);
  });

  it('asks for the proposed solution', () => {
    const c = readFile('.github/ISSUE_TEMPLATE/feature_request.md').toLowerCase();
    expect(c).toMatch(/solution|proposal/);
  });

  it('references ROADMAP.md (scope check)', () => {
    expect(readFile('.github/ISSUE_TEMPLATE/feature_request.md')).toContain('ROADMAP.md');
  });
});

// ---------------------------------------------------------------------------
// .github/ISSUE_TEMPLATE/config.yml
// ---------------------------------------------------------------------------

describe('M4-Community — config.yml', () => {
  it('.github/ISSUE_TEMPLATE/config.yml exists', () => {
    expect(fileExists('.github/ISSUE_TEMPLATE/config.yml')).toBe(true);
  });

  it('disables blank issues (directs to templates)', () => {
    const c = readFile('.github/ISSUE_TEMPLATE/config.yml');
    expect(c).toContain('blank_issues_enabled: false');
  });

  it('has a contact link for security vulnerabilities pointing to SECURITY.md', () => {
    const c = readFile('.github/ISSUE_TEMPLATE/config.yml');
    expect(c).toContain('SECURITY.md');
  });
});

// ---------------------------------------------------------------------------
// .github/PULL_REQUEST_TEMPLATE.md
// ---------------------------------------------------------------------------

describe('M4-Community — PULL_REQUEST_TEMPLATE.md', () => {
  it('.github/PULL_REQUEST_TEMPLATE.md exists', () => {
    expect(fileExists('.github/PULL_REQUEST_TEMPLATE.md')).toBe(true);
  });

  it('has a typecheck checklist item', () => {
    const c = readFile('.github/PULL_REQUEST_TEMPLATE.md').toLowerCase();
    expect(c).toContain('typecheck');
  });

  it('has a lint checklist item', () => {
    const c = readFile('.github/PULL_REQUEST_TEMPLATE.md').toLowerCase();
    expect(c).toContain('lint');
  });

  it('has a coverage checklist item mentioning 90 %', () => {
    const c = readFile('.github/PULL_REQUEST_TEMPLATE.md');
    expect(c).toMatch(/coverage.*90|90.*coverage/i);
  });

  it('notes dist/ must not be included', () => {
    const c = readFile('.github/PULL_REQUEST_TEMPLATE.md').toLowerCase();
    expect(c).toContain('dist');
    expect(c).toMatch(/not.*includ|never.*commit|generated/);
  });

  it('has a type-of-change section', () => {
    const c = readFile('.github/PULL_REQUEST_TEMPLATE.md').toLowerCase();
    expect(c).toMatch(/type.*change|change.*type/);
  });

  it('mentions read-only constraint (no writes)', () => {
    const c = readFile('.github/PULL_REQUEST_TEMPLATE.md').toLowerCase();
    expect(c).toMatch(/read.?only|never.*write|writes.*nothing/);
  });

  it('mentions theme-native CSS variables', () => {
    const c = readFile('.github/PULL_REQUEST_TEMPLATE.md');
    expect(c).toMatch(/--vscode-|theme-native/);
  });
});

// ---------------------------------------------------------------------------
// Cross-file consistency checks
// ---------------------------------------------------------------------------

describe('M4-Community — cross-file consistency', () => {
  const FILES = [
    'CONTRIBUTING.md',
    'SECURITY.md',
    'CODE_OF_CONDUCT.md',
    '.github/ISSUE_TEMPLATE/bug_report.md',
    '.github/ISSUE_TEMPLATE/feature_request.md',
    '.github/ISSUE_TEMPLATE/config.yml',
    '.github/PULL_REQUEST_TEMPLATE.md',
  ];

  it('all community files exist', () => {
    for (const f of FILES) {
      expect(fileExists(f), `Missing: ${f}`).toBe(true);
    }
  });

  it('no community file references a wrong repo owner (e.g. malte-langermann as repo owner)', () => {
    // Repo owner is gagarinlg; publisher (Marketplace) is malte-langermann.
    // None of these files should use malte-langermann as the GitHub repo owner.
    for (const f of FILES) {
      if (!fileExists(f)) continue;
      const c = readFile(f);
      // If gagarinlg/claude-code-workflow-dashboard is present, it must not say
      // malte-langermann/claude-code-workflow-dashboard (wrong owner).
      const wrongOwner = 'malte-langermann/claude-code-workflow-dashboard';
      expect(c, `${f} uses wrong repo owner: ${wrongOwner}`).not.toContain(wrongOwner);
    }
  });

  it('CONTRIBUTING.md does not misrepresent affiliation (no "official" or "Anthropic-affiliated")', () => {
    const c = readFile('CONTRIBUTING.md').toLowerCase();
    expect(c).not.toMatch(/official\s+anthropic|affiliated\s+with\s+anthropic\s+(?!disclaimer|not)/);
  });

  it('community files do not reference the wrong default branch', () => {
    // Default branch is master, not main.
    for (const f of FILES) {
      if (!fileExists(f)) continue;
      const c = readFile(f);
      // Allow the word "main" only as part of "maintainer", "maintain", etc.
      // Any bare "branch: main" or "from main" is a bug.
      const branchMain = /\bbranch.*\bmain\b|\bfrom\s+main\b/i;
      expect(c, `${f} references wrong branch 'main' instead of 'master'`).not.toMatch(branchMain);
    }
  });

  it('LICENSE file remains GPL-3.0-or-later', () => {
    const license = readFile('LICENSE');
    expect(license).toMatch(/GNU GENERAL PUBLIC LICENSE/i);
    expect(license).toMatch(/Version 3/i);
  });
});
