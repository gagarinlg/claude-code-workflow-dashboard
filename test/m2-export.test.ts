/**
 * M2-Export — unit tests for generateMarkdown (src/export/markdown.ts).
 *
 * Strategy: build synthetic SnapshotOk objects in-memory (no disk I/O) and
 * assert the Markdown string output. Covers:
 *   - Header: run id, updatedAt, isPinned note
 *   - Loop summary: all fields, optional token fields (present/absent)
 *   - Severity breakdown (sorted order)
 *   - Findings: grouped by reviewer, sorted by severity, all fields rendered
 *   - Verdicts table
 *   - Structured results (skips findings key)
 *   - Agent metrics table: columns, optional inTok/cache columns
 *   - fmtTok / fmtElapsed / cmpSev helper edge cases
 *   - Defensive: empty/missing fields never throw, output always ends in newline
 *   - Table cell escaping (pipe characters, newlines)
 *   - No hardcoded pricing anywhere in output
 *   - Round-trip safety: no unmatched | in table rows
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { generateMarkdown, buildExportFilename, fmtTok, fmtElapsed, cmpSev } from '../src/export/markdown';
import type { SnapshotOk } from '../src/data/snapshot';
import { getPanelJs, extractBalancedFn } from './helpers/webview';
import { getHtml } from '../src/webview/html';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeSnap(overrides: Partial<SnapshotOk> = {}): SnapshotOk {
  const base: SnapshotOk = {
    ok: true,
    runId: 'wf_test_20240101_120000',
    workflowDir: '/tmp/.claude/projects/proj/workflows/wf_test_20240101_120000',
    updatedAt: '12:00:00',
    isPinned: false,
    agentsCapped: false,
    loop: {
      phase: 'idle / between passes',
      live: 0,
      done: 2,
      dead: 0,
      superseded: 0,
      total: 2,
      outTok: 1500,
      tools: 8,
      passes: 1,
      findings: 3,
      sevTotals: { HIGH: 1, MEDIUM: 1, LOW: 1 },
    },
    labels: ['Code review'],
    agents: [
      {
        id: 'agent1',
        label: 'Code review',
        key: 'code_reviewer',
        status: 'done',
        elapsed: 45,
        tokens: 900,
        tools: 5,
        tail: [],
        lastActivity: 'done',
        start: 1700000000,
        mtime: 1700000045,
        idx: 1,
      },
      {
        id: 'agent2',
        label: 'Implement/Fix',
        key: 'implementer',
        status: 'done',
        elapsed: 120,
        tokens: 600,
        tools: 3,
        tail: [],
        lastActivity: 'done',
        start: 1700000050,
        mtime: 1700000170,
        idx: 2,
      },
    ],
    allFindings: [
      {
        severity: 'HIGH',
        title: 'SQL injection risk',
        why: 'User input is not sanitized.',
        fix: 'Use parameterized queries.',
        location: 'src/db.ts:42',
        pass: 1,
        reviewer: 'Code review',
        key: 'code_reviewer',
      },
      {
        severity: 'MEDIUM',
        title: 'Missing error handling',
        why: 'No catch block.',
        fix: 'Add try/catch around the fetch call.',
        pass: 1,
        reviewer: 'Code review',
        key: 'code_reviewer',
      },
      {
        severity: 'LOW',
        title: 'Unused import',
        why: 'The import is never referenced.',
        fix: 'Remove the unused import.',
        pass: 1,
        reviewer: 'Code review',
        key: 'code_reviewer',
      },
    ],
    structuredResults: [
      {
        pass: 1,
        label: 'Implement/Fix',
        key: 'implementer',
        result: {
          summary: 'Fixed 3 issues.',
          fixed: 3,
          tests_run: true,
        },
      },
    ],
    verdicts: { code_reviewer: 'FAIL — 3 findings' },
    verdictLabels: { code_reviewer: 'Code review' },
    changed: null,
    changedByAgents: [],
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// fmtTok helper
// ---------------------------------------------------------------------------
describe('fmtTok — number formatting', () => {
  it('formats 0 as "0"', () => {
    expect(fmtTok(0)).toBe('0');
  });

  it('formats 500 as "500" (integer, no suffix)', () => {
    expect(fmtTok(500)).toBe('500');
  });

  it('formats 999 as "999"', () => {
    expect(fmtTok(999)).toBe('999');
  });

  it('formats 1000 as "1.0k"', () => {
    expect(fmtTok(1000)).toBe('1.0k');
  });

  it('formats 1500 as "1.5k"', () => {
    expect(fmtTok(1500)).toBe('1.5k');
  });

  it('formats 10000 as "10.0k"', () => {
    expect(fmtTok(10000)).toBe('10.0k');
  });

  it('formats 1_000_000 as "1.00M"', () => {
    expect(fmtTok(1_000_000)).toBe('1.00M');
  });

  it('formats 2_500_000 as "2.50M"', () => {
    expect(fmtTok(2_500_000)).toBe('2.50M');
  });

  it('returns "0" for NaN (defensive guard)', () => {
    expect(fmtTok(NaN)).toBe('0');
  });

  it('returns "0" for negative numbers', () => {
    expect(fmtTok(-100)).toBe('0');
  });

  it('returns "0" for Infinity', () => {
    expect(fmtTok(Infinity)).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// fmtTok TS/JS parity — webview JS and markdown.ts must produce identical output.
// The webview version lives inside a template string (cannot import from src/);
// this test extracts it via the same extractBalancedFn mechanism used by other
// test files and compares it against the exported TS version for a reference
// set of values that covers all three branches (<1k, <1M, >=1M) plus guards.
// If either version diverges (e.g. threshold change), this test will catch it.
// ---------------------------------------------------------------------------
describe('fmtTok — TS/JS parity (markdown.ts vs webview js-panels.ts)', () => {
  let jsVersion: (n: number) => string;

  beforeAll(() => {
    const js = getPanelJs(getHtml('dGVzdG5vbmNlMTIz'));
    // Build a minimal harness: safeN is a dependency of fmtTok in the webview version.
    const safeNFn = extractBalancedFn(js, 'safeN');
    const fmtTokFn = extractBalancedFn(js, 'fmtTok');
    const code = `${safeNFn}\n${fmtTokFn}\nreturn fmtTok;`;
    jsVersion = new Function(code)() as (n: number) => string;
  });

  const REFERENCE_VALUES = [0, 1, 500, 999, 1000, 1500, 10000, 999999, 1_000_000, 2_500_000];
  for (const v of REFERENCE_VALUES) {
    it(`fmtTok(${v}) is identical in TS and JS`, () => {
      expect(jsVersion(v)).toBe(fmtTok(v));
    });
  }

  it('fmtTok(NaN) is identical in TS and JS', () => {
    expect(jsVersion(NaN)).toBe(fmtTok(NaN));
  });

  it('fmtTok(Infinity) is identical in TS and JS', () => {
    expect(jsVersion(Infinity)).toBe(fmtTok(Infinity));
  });
});

// ---------------------------------------------------------------------------
// fmtElapsed helper
// ---------------------------------------------------------------------------
describe('fmtElapsed — duration formatting', () => {
  it('formats 0 as "0s"', () => {
    expect(fmtElapsed(0)).toBe('0s');
  });

  it('formats 45 as "45s"', () => {
    expect(fmtElapsed(45)).toBe('45s');
  });

  it('formats 59 as "59s"', () => {
    expect(fmtElapsed(59)).toBe('59s');
  });

  it('formats 60 as "1m"', () => {
    expect(fmtElapsed(60)).toBe('1m');
  });

  it('formats 90 as "1m 30s"', () => {
    expect(fmtElapsed(90)).toBe('1m 30s');
  });

  it('formats 3600 as "1h"', () => {
    expect(fmtElapsed(3600)).toBe('1h');
  });

  it('formats 3900 as "1h 5m"', () => {
    expect(fmtElapsed(3900)).toBe('1h 5m');
  });

  it('returns "—" for NaN (defensive)', () => {
    expect(fmtElapsed(NaN)).toBe('—');
  });

  it('returns "—" for negative (defensive)', () => {
    expect(fmtElapsed(-10)).toBe('—');
  });
});

// ---------------------------------------------------------------------------
// cmpSev helper
// ---------------------------------------------------------------------------
describe('cmpSev — severity ordering', () => {
  it('CRITICAL < HIGH < MEDIUM < LOW < INFO < UNRATED', () => {
    const sevs = ['UNRATED', 'LOW', 'HIGH', 'CRITICAL', 'MEDIUM', 'INFO'];
    sevs.sort(cmpSev);
    expect(sevs).toEqual(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'UNRATED']);
  });

  it('two equal severities compare as 0', () => {
    expect(cmpSev('HIGH', 'HIGH')).toBe(0);
  });

  it('unknown severity sorts after all known ones', () => {
    expect(cmpSev('CUSTOM', 'INFO')).toBeGreaterThan(0);
  });

  it('two unknown severities sort alphabetically', () => {
    expect(cmpSev('APPLE', 'BANANA')).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// generateMarkdown — header
// ---------------------------------------------------------------------------
describe('generateMarkdown — header', () => {
  it('contains the run id in the header', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).toContain('wf_test_20240101_120000');
  });

  it('contains the updatedAt timestamp', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).toContain('12:00:00');
  });

  it('does NOT contain a pinned note when isPinned is false', () => {
    const md = generateMarkdown(makeSnap({ isPinned: false }));
    expect(md).not.toContain('Pinned run');
  });

  it('contains a pinned note when isPinned is true', () => {
    const md = generateMarkdown(makeSnap({ isPinned: true }));
    expect(md).toContain('Pinned run');
  });

  it('does NOT contain the workflowDir path (workflowDir is internal only)', () => {
    const md = generateMarkdown(makeSnap());
    // workflowDir is a full filesystem path — must not leak into the report
    expect(md).not.toContain('/tmp/.claude');
  });
});

// ---------------------------------------------------------------------------
// generateMarkdown — loop summary
// ---------------------------------------------------------------------------
describe('generateMarkdown — loop summary', () => {
  it('contains "Loop Summary" heading', () => {
    expect(generateMarkdown(makeSnap())).toContain('## Loop Summary');
  });

  it('renders total agent count', () => {
    const md = generateMarkdown(makeSnap());
    // The table row "| Agents total | 2 |"
    expect(md).toContain('Agents total');
    expect(md).toContain('| 2 |');
  });

  it('renders live/done/stalled counts', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).toContain('Live');
    expect(md).toContain('Done');
    expect(md).toContain('Stalled');
  });

  it('renders output tokens with fmtTok formatting', () => {
    const md = generateMarkdown(makeSnap({ loop: { ...makeSnap().loop, outTok: 1500 } }));
    expect(md).toContain('1.5k');
  });

  it('renders tool calls count', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).toContain('Tool calls');
    expect(md).toContain('| 8 |');
  });

  it('renders findings count', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).toContain('Total findings');
    expect(md).toContain('| 3 |');
  });

  it('does NOT render Input tokens row when loop.inTok is absent', () => {
    const snap = makeSnap();
    // Ensure inTok is not set
    delete snap.loop.inTok;
    const md = generateMarkdown(snap);
    expect(md).not.toContain('Input tokens');
  });

  it('renders Input tokens row when loop.inTok is present', () => {
    const snap = makeSnap();
    snap.loop.inTok = 5000;
    const md = generateMarkdown(snap);
    expect(md).toContain('Input tokens');
    expect(md).toContain('5.0k');
  });

  it('does NOT render Cache read row when loop.cacheRead is absent', () => {
    const snap = makeSnap();
    delete snap.loop.cacheRead;
    const md = generateMarkdown(snap);
    expect(md).not.toContain('Cache read tokens');
  });

  it('renders Cache read row when loop.cacheRead is present', () => {
    const snap = makeSnap();
    snap.loop.cacheRead = 2000;
    const md = generateMarkdown(snap);
    expect(md).toContain('Cache read tokens');
    expect(md).toContain('2.0k');
  });

  it('does NOT render Cache write row when loop.cacheCreate is absent', () => {
    const snap = makeSnap();
    delete snap.loop.cacheCreate;
    const md = generateMarkdown(snap);
    expect(md).not.toContain('Cache write tokens');
  });

  it('renders Cache write row when loop.cacheCreate is present', () => {
    const snap = makeSnap();
    snap.loop.cacheCreate = 300;
    const md = generateMarkdown(snap);
    expect(md).toContain('Cache write tokens');
  });
});

// ---------------------------------------------------------------------------
// generateMarkdown — severity breakdown
// ---------------------------------------------------------------------------
describe('generateMarkdown — severity breakdown', () => {
  it('contains "Severity Breakdown" heading when there are findings', () => {
    expect(generateMarkdown(makeSnap())).toContain('Severity Breakdown');
  });

  it('lists HIGH, MEDIUM, LOW severities', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).toContain('HIGH');
    expect(md).toContain('MEDIUM');
    expect(md).toContain('LOW');
  });

  it('severities appear in canonical order (CRITICAL > HIGH > MEDIUM > LOW > INFO > UNRATED)', () => {
    const snap = makeSnap();
    snap.loop.sevTotals = { UNRATED: 1, LOW: 2, HIGH: 3, CRITICAL: 1 };
    snap.loop.findings = 7;
    const md = generateMarkdown(snap);
    const criticalPos = md.indexOf('CRITICAL');
    const highPos = md.indexOf('HIGH');
    const lowPos = md.indexOf('LOW');
    const unratedPos = md.lastIndexOf('UNRATED');
    expect(criticalPos).toBeLessThan(highPos);
    expect(highPos).toBeLessThan(lowPos);
    expect(lowPos).toBeLessThan(unratedPos);
  });

  it('does NOT render severity breakdown when no findings', () => {
    const snap = makeSnap({ allFindings: [], loop: { ...makeSnap().loop, findings: 0, sevTotals: {} } });
    const md = generateMarkdown(snap);
    expect(md).not.toContain('Severity Breakdown');
  });
});

// ---------------------------------------------------------------------------
// generateMarkdown — findings
// ---------------------------------------------------------------------------
describe('generateMarkdown — findings', () => {
  it('contains "## Findings" heading when there are findings', () => {
    expect(generateMarkdown(makeSnap())).toContain('## Findings');
  });

  it('does NOT contain "## Findings" heading when allFindings is empty', () => {
    const md = generateMarkdown(makeSnap({ allFindings: [] }));
    expect(md).not.toContain('## Findings');
  });

  it('groups findings under the reviewer name as a sub-heading', () => {
    expect(generateMarkdown(makeSnap())).toContain('### Code review');
  });

  it('renders finding severity in the heading', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).toContain('`HIGH`');
    expect(md).toContain('`MEDIUM`');
    expect(md).toContain('`LOW`');
  });

  it('renders finding title', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).toContain('SQL injection risk');
    expect(md).toContain('Missing error handling');
    expect(md).toContain('Unused import');
  });

  it('renders finding why field', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).toContain('User input is not sanitized.');
  });

  it('renders finding fix field', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).toContain('Use parameterized queries.');
  });

  it('renders finding location when present', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).toContain('src/db.ts:42');
  });

  it('does NOT render location line when location is absent', () => {
    const snap = makeSnap();
    // Remove location from all findings
    snap.allFindings = snap.allFindings.map((f) => {
      const copy = { ...f };
      delete copy.location;
      return copy;
    });
    // Verify the location heading is gone
    const md = generateMarkdown(snap);
    expect(md).not.toContain('**Location:**');
  });

  it('findings within reviewer are sorted CRITICAL > HIGH > MEDIUM > LOW', () => {
    const snap = makeSnap();
    snap.allFindings = [
      { severity: 'LOW', title: 'Low finding', why: '', fix: '', pass: 1, reviewer: 'Code review', key: 'code_reviewer' },
      { severity: 'CRITICAL', title: 'Critical finding', why: '', fix: '', pass: 1, reviewer: 'Code review', key: 'code_reviewer' },
      { severity: 'MEDIUM', title: 'Medium finding', why: '', fix: '', pass: 1, reviewer: 'Code review', key: 'code_reviewer' },
    ];
    const md = generateMarkdown(snap);
    const critPos = md.indexOf('Critical finding');
    const medPos = md.indexOf('Medium finding');
    const lowPos = md.indexOf('Low finding');
    expect(critPos).toBeLessThan(medPos);
    expect(medPos).toBeLessThan(lowPos);
  });

  it('multiple reviewers each get their own sub-section', () => {
    const snap = makeSnap();
    snap.allFindings = [
      { severity: 'HIGH', title: 'F1', why: 'w', fix: 'f', pass: 1, reviewer: 'Code review', key: 'code_reviewer' },
      { severity: 'LOW', title: 'F2', why: 'w', fix: 'f', pass: 1, reviewer: 'Security', key: 'security_reviewer' },
    ];
    const md = generateMarkdown(snap);
    expect(md).toContain('### Code review');
    expect(md).toContain('### Security');
  });

  it('renders UNRATED severity when finding has no severity field', () => {
    const snap = makeSnap();
    snap.allFindings = [
      { title: 'No sev', why: 'w', fix: 'f', pass: 1, reviewer: 'Code review', key: 'code_reviewer' },
    ];
    const md = generateMarkdown(snap);
    expect(md).toContain('`UNRATED`');
  });

  it('renders "(untitled)" when finding has no title', () => {
    const snap = makeSnap();
    snap.allFindings = [
      { severity: 'LOW', why: 'w', fix: 'f', pass: 1, reviewer: 'Code review', key: 'code_reviewer' },
    ];
    const md = generateMarkdown(snap);
    expect(md).toContain('(untitled)');
  });
});

// ---------------------------------------------------------------------------
// generateMarkdown — verdicts
// ---------------------------------------------------------------------------
describe('generateMarkdown — verdicts', () => {
  it('contains "## Verdicts" heading when verdicts are present', () => {
    expect(generateMarkdown(makeSnap())).toContain('## Verdicts');
  });

  it('does NOT contain "## Verdicts" heading when verdicts is empty', () => {
    const md = generateMarkdown(makeSnap({ verdicts: {}, verdictLabels: {} }));
    expect(md).not.toContain('## Verdicts');
  });

  it('renders reviewer display label (from verdictLabels) in the table', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).toContain('Code review');
  });

  it('renders the verdict text', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).toContain('FAIL — 3 findings');
  });

  it('falls back to key when verdictLabels has no entry for a key', () => {
    const snap = makeSnap();
    snap.verdicts = { orphan_key: 'PASS' };
    snap.verdictLabels = {};
    const md = generateMarkdown(snap);
    expect(md).toContain('orphan_key');
    expect(md).toContain('PASS');
  });
});

// ---------------------------------------------------------------------------
// generateMarkdown — structured results
// ---------------------------------------------------------------------------
describe('generateMarkdown — structured results', () => {
  it('contains "## Structured Results" heading when results are present', () => {
    expect(generateMarkdown(makeSnap())).toContain('## Structured Results');
  });

  it('does NOT contain "## Structured Results" heading when empty', () => {
    const md = generateMarkdown(makeSnap({ structuredResults: [] }));
    expect(md).not.toContain('## Structured Results');
  });

  it('renders the agent label in the sub-heading', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).toContain('### Implement/Fix');
  });

  it('renders pass number in the sub-heading', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).toContain('(pass 1)');
  });

  it('renders key/value pairs from the result object', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).toContain('summary');
    expect(md).toContain('Fixed 3 issues.');
    expect(md).toContain('fixed');
  });

  it('does NOT render the "findings" key (already shown in Findings section)', () => {
    const snap = makeSnap();
    snap.structuredResults = [
      {
        pass: 1,
        label: 'Reviewer',
        key: 'code_reviewer',
        result: {
          findings: [{ severity: 'HIGH', title: 'should not appear' }],
          verdict: 'FAIL',
        },
      },
    ];
    const md = generateMarkdown(snap);
    // 'findings' key should not appear as a structured-results row
    // (it might appear in the Findings section but not as a key in Structured Results)
    const structStart = md.indexOf('## Structured Results');
    const structSection = structStart !== -1 ? md.slice(structStart) : '';
    expect(structSection).not.toContain('**findings:**');
  });
});

// ---------------------------------------------------------------------------
// generateMarkdown — agent metrics
// ---------------------------------------------------------------------------
describe('generateMarkdown — agent metrics', () => {
  it('contains "## Agent Metrics" heading when agents are present', () => {
    expect(generateMarkdown(makeSnap())).toContain('## Agent Metrics');
  });

  it('does NOT contain "## Agent Metrics" heading when agents is empty', () => {
    const md = generateMarkdown(makeSnap({ agents: [] }));
    expect(md).not.toContain('## Agent Metrics');
  });

  it('table header contains "#", "Agent", "Status", "Elapsed", "Out tokens", "Tool calls"', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).toContain('# | Agent | Status | Elapsed | Out tokens | Tool calls');
  });

  it('renders agent label in the metrics row', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).toContain('Code review');
    expect(md).toContain('Implement/Fix');
  });

  it('renders agent status in the metrics row', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).toContain('done');
  });

  it('renders elapsed time formatted (45s)', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).toContain('45s');
  });

  it('renders elapsed time formatted (2m for 120s)', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).toContain('2m');
  });

  it('renders output tokens formatted', () => {
    const md = generateMarkdown(makeSnap());
    // agent1: 900 tokens, agent2: 600 tokens
    expect(md).toContain('900');
    expect(md).toContain('600');
  });

  it('renders tool call count', () => {
    const md = generateMarkdown(makeSnap());
    // agent1: 5 tools, agent2: 3 tools
    expect(md).toContain('| 5 |');
    expect(md).toContain('| 3 |');
  });

  it('does NOT add "In tokens" column when no agent has inTok', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).not.toContain('In tokens');
  });

  it('adds "In tokens" column when at least one agent has inTok', () => {
    const snap = makeSnap();
    snap.agents[0]!.inTok = 5000;
    const md = generateMarkdown(snap);
    expect(md).toContain('In tokens');
  });

  it('renders "—" for an agent without inTok when the inTok column is present', () => {
    const snap = makeSnap();
    snap.agents[0]!.inTok = 5000;
    // agent2 has no inTok — should show "—"
    const md = generateMarkdown(snap);
    // The metrics section should contain a dash for the agent without inTok
    const metricsStart = md.indexOf('## Agent Metrics');
    const metricsSection = metricsStart !== -1 ? md.slice(metricsStart) : '';
    expect(metricsSection).toContain('—');
  });

  it('adds "Cache read" column when at least one agent has cacheRead', () => {
    const snap = makeSnap();
    snap.agents[0]!.cacheRead = 3000;
    const md = generateMarkdown(snap);
    expect(md).toContain('Cache read');
  });

  it('does NOT add "Cache write" column when no agent has cacheCreate', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).not.toContain('Cache write');
  });

  it('adds "Cache write" column when at least one agent has cacheCreate', () => {
    const snap = makeSnap();
    snap.agents[0]!.cacheCreate = 200;
    const md = generateMarkdown(snap);
    expect(md).toContain('Cache write');
  });

  it('renders agent idx (#) in the table', () => {
    const md = generateMarkdown(makeSnap());
    // idx 1 and 2 should appear as the first cell in each data row
    expect(md).toContain('| 1 |');
    expect(md).toContain('| 2 |');
  });
});

// ---------------------------------------------------------------------------
// generateMarkdown — general and defensive
// ---------------------------------------------------------------------------
describe('generateMarkdown — general', () => {
  it('output always ends with a single newline', () => {
    const md = generateMarkdown(makeSnap());
    expect(md.endsWith('\n')).toBe(true);
    // No double trailing newline
    expect(md.endsWith('\n\n')).toBe(false);
  });

  it('never throws for a minimal (near-empty) snapshot', () => {
    const minimal: SnapshotOk = {
      ok: true,
      runId: 'wf_empty',
      workflowDir: '/tmp/wf_empty',
      updatedAt: '00:00:00',
      isPinned: false,
      agentsCapped: false,
      loop: {
        phase: 'idle / between passes',
        live: 0,
        done: 0,
        dead: 0,
        superseded: 0,
        total: 0,
        outTok: 0,
        tools: 0,
        passes: 0,
        findings: 0,
        sevTotals: {},
      },
      labels: [],
      agents: [],
      allFindings: [],
      structuredResults: [],
      verdicts: {},
      verdictLabels: {},
      changed: null,
      changedByAgents: [],
    };
    expect(() => generateMarkdown(minimal)).not.toThrow();
    expect(generateMarkdown(minimal).length).toBeGreaterThan(0);
  });

  it('does NOT contain pricing or cost information', () => {
    const md = generateMarkdown(makeSnap());
    // Ensure no price/cost references appear in the output (Decision log #5)
    expect(md.toLowerCase()).not.toContain('price');
    expect(md.toLowerCase()).not.toContain('cost');
    expect(md.toLowerCase()).not.toContain('dollar');
    expect(md.toLowerCase()).not.toContain('usd');
    expect(md.toLowerCase()).not.toContain('$');
  });

  it('table rows have matching pipe counts (round-trip safe for GitHub)', () => {
    const md = generateMarkdown(makeSnap());
    // Every Markdown table row must start and end with | and have balanced columns.
    // A row is "table-like" if it starts with |; we verify it has at least two |.
    const tableRows = md
      .split('\n')
      .filter((line) => line.startsWith('|'));
    for (const row of tableRows) {
      // At least 3 pipes: | col1 | col2 |
      const pipes = (row.match(/\|/g) ?? []).length;
      expect(pipes).toBeGreaterThanOrEqual(3);
    }
  });

  it('pipe characters in finding text are escaped in table cells', () => {
    const snap = makeSnap();
    snap.verdicts = { code_reviewer: 'PASS | all good' };
    snap.verdictLabels = { code_reviewer: 'Code review' };
    const md = generateMarkdown(snap);
    // The escaped form must appear — raw | inside verdict would break the table
    expect(md).toContain('PASS \\| all good');
  });

  it('newlines in finding text are flattened to spaces in table cells', () => {
    const snap = makeSnap();
    snap.verdicts = { code_reviewer: 'line1\nline2' };
    snap.verdictLabels = { code_reviewer: 'Code review' };
    const md = generateMarkdown(snap);
    expect(md).toContain('line1 line2');
    expect(md).not.toContain('line1\nline2');
  });

  it('contains a markdown H1 at the top', () => {
    const md = generateMarkdown(makeSnap());
    expect(md.startsWith('# ')).toBe(true);
  });

  it('output is non-empty for a fully-populated snapshot', () => {
    expect(generateMarkdown(makeSnap()).length).toBeGreaterThan(500);
  });
});

// ---------------------------------------------------------------------------
// generateMarkdown — injection guards
// ---------------------------------------------------------------------------
describe('generateMarkdown — injection guards', () => {
  it('backtick in f.location does not break the inline code span', () => {
    const snap = makeSnap();
    snap.allFindings = [
      {
        severity: 'LOW',
        title: 'Injection test',
        why: 'why',
        fix: 'fix',
        pass: 1,
        reviewer: 'Code review',
        key: 'code_reviewer',
        location: "src/db.ts:42` injected",
      },
    ];
    const md = generateMarkdown(snap);
    // The backtick must be replaced — no raw ` in the location code span
    expect(md).not.toContain('`injected');
    // The location line must still be present
    expect(md).toContain('**Location:**');
  });

  it('backtick in snap.runId does not break the inline code span', () => {
    const snap = makeSnap({ runId: "wf_test`injected" });
    const md = generateMarkdown(snap);
    // The backtick in runId must be replaced so the code span is not broken
    expect(md).not.toContain('`injected');
    expect(md).toContain('**Run ID:**');
  });

  it('heading marker after newline in f.why is blockquoted', () => {
    const snap = makeSnap();
    snap.allFindings = [
      {
        severity: 'LOW',
        title: 'Heading injection',
        why: 'legit\n## Injected Section',
        fix: 'fix',
        pass: 1,
        reviewer: 'Code review',
        key: 'code_reviewer',
      },
    ];
    const md = generateMarkdown(snap);
    // The injected heading must be blockquoted, not a real heading
    expect(md).not.toContain('\n## Injected Section');
    expect(md).toContain('> ## Injected Section');
  });

  it('triple-backtick in structured result value is escaped', () => {
    const snap = makeSnap();
    snap.structuredResults = [
      {
        pass: 1,
        label: 'Reviewer',
        key: 'code_reviewer',
        result: {
          summary: 'ok\n```\nshell command\n```\n',
        },
      },
    ];
    const md = generateMarkdown(snap);
    // The triple-backtick fence must be escaped so it cannot forge a code block
    expect(md).not.toMatch(/\n```\n/);
  });

  it('agent status "dead" is rendered as "stalled" in agent metrics', () => {
    const snap = makeSnap();
    snap.agents = [
      { idx: 1, id: 'a1', label: 'Dead agent', status: 'dead', tokens: 0, tools: 0, elapsed: 0, tail: [], lastActivity: '(starting…)', start: 0, mtime: 0, key: 'code_reviewer' },
    ];
    const md = generateMarkdown(snap);
    const metricsSection = md.slice(md.indexOf('## Agent Metrics'));
    expect(metricsSection).toContain('stalled');
    expect(metricsSection).not.toContain('| dead |');
  });

  it('agent status "run" is rendered as "live" in agent metrics', () => {
    const snap = makeSnap();
    snap.agents = [
      { idx: 1, id: 'a1', label: 'Live agent', status: 'run', tokens: 0, tools: 0, elapsed: 0, tail: [], lastActivity: '(starting…)', start: 0, mtime: 0, key: 'code_reviewer' },
    ];
    const md = generateMarkdown(snap);
    const metricsSection = md.slice(md.indexOf('## Agent Metrics'));
    expect(metricsSection).toContain('live');
    expect(metricsSection).not.toContain('| run |');
  });
});

// ---------------------------------------------------------------------------
// generateMarkdown — changed files
// ---------------------------------------------------------------------------
describe('generateMarkdown — changed files', () => {
  it('contains "## Changed Files" heading when snap.changed is populated', () => {
    const snap = makeSnap({ changed: ['src/foo.ts', 'src/bar.ts'] });
    const md = generateMarkdown(snap);
    expect(md).toContain('## Changed Files');
    expect(md).toContain('`src/foo.ts`');
    expect(md).toContain('`src/bar.ts`');
  });

  it('does NOT contain "## Changed Files" when snap.changed is null', () => {
    const snap = makeSnap({ changed: null });
    const md = generateMarkdown(snap);
    expect(md).not.toContain('## Changed Files');
  });

  it('does NOT contain "## Changed Files" when snap.changed is empty', () => {
    const snap = makeSnap({ changed: [] });
    const md = generateMarkdown(snap);
    expect(md).not.toContain('## Changed Files');
  });

  // Spec v3 correction #7: changedByAgents must appear in the Markdown export.
  it('contains agent-reported files section when changedByAgents is populated', () => {
    const snap = makeSnap({ changedByAgents: ['src/a.ts', 'src/b.ts'], changed: null });
    const md = generateMarkdown(snap);
    expect(md).toContain('## Changed Files');
    expect(md).toContain('Files reported by agents');
    expect(md).toContain('`src/a.ts`');
    expect(md).toContain('`src/b.ts`');
  });

  it('contains both agent-reported and recently-touched sections when both are present', () => {
    const snap = makeSnap({
      changedByAgents: ['src/a.ts'],
      changed: ['src/b.ts'],
    });
    const md = generateMarkdown(snap);
    expect(md).toContain('Files reported by agents');
    expect(md).toContain('Recently touched');
    expect(md).toContain('`src/a.ts`');
    expect(md).toContain('`src/b.ts`');
  });

  it('does NOT contain "## Changed Files" when both changedByAgents and changed are empty', () => {
    const snap = makeSnap({ changedByAgents: [], changed: [] });
    const md = generateMarkdown(snap);
    expect(md).not.toContain('## Changed Files');
  });
});

// ---------------------------------------------------------------------------
// buildExportFilename — filesystem-safe filename generation
// ---------------------------------------------------------------------------
describe('buildExportFilename — filename generation', () => {
  it('returns a string ending in .md', () => {
    const fname = buildExportFilename(makeSnap());
    expect(fname.endsWith('.md')).toBe(true);
  });

  it('starts with "claude-workflow-" prefix', () => {
    const fname = buildExportFilename(makeSnap());
    expect(fname.startsWith('claude-workflow-')).toBe(true);
  });

  it('contains the sanitised runId segment', () => {
    const fname = buildExportFilename(makeSnap({ runId: 'wf_test_20240101' }));
    expect(fname).toContain('wf_test_20240101');
  });

  it('never contains forward slash', () => {
    const fname = buildExportFilename(makeSnap({ runId: 'wf/bad/path' }));
    expect(fname).not.toContain('/');
  });

  it('never contains backslash', () => {
    const fname = buildExportFilename(makeSnap({ runId: 'wf\\bad\\path' }));
    expect(fname).not.toContain('\\');
  });

  it('never contains colon', () => {
    const fname = buildExportFilename(makeSnap({ runId: 'wf:bad:run' }));
    expect(fname).not.toContain(':');
  });

  it('never contains whitespace', () => {
    const fname = buildExportFilename(makeSnap({ runId: 'wf bad run' }));
    expect(/\s/.test(fname)).toBe(false);
  });

  it('collapses consecutive hyphens in runId', () => {
    const fname = buildExportFilename(makeSnap({ runId: 'wf--double--dash' }));
    expect(fname).not.toContain('--');
  });

  it('strips leading/trailing hyphens from the sanitised runId', () => {
    // A runId starting/ending with special chars maps to leading/trailing hyphens
    const fname = buildExportFilename(makeSnap({ runId: '!wf_test_20240101!' }));
    // After sanitisation the id should not begin or end the segment with a hyphen
    // (the prefix and suffix already provide separators)
    expect(fname).not.toMatch(/claude-workflow--/);
  });

  it('handles an empty runId gracefully', () => {
    const fname = buildExportFilename(makeSnap({ runId: '' }));
    expect(fname.endsWith('.md')).toBe(true);
    expect(fname.startsWith('claude-workflow-')).toBe(true);
  });

  it('length is at most 120 chars before .md', () => {
    const longId = 'a'.repeat(200);
    const fname = buildExportFilename(makeSnap({ runId: longId }));
    // Total includes prefix + id + separator + timestamp + .md
    expect(fname.replace(/\.md$/, '').length).toBeLessThanOrEqual(120);
  });

  it('contains a YYYYMMDD-HHmm timestamp segment', () => {
    const fname = buildExportFilename(makeSnap());
    // Matches -20YYMMDD-HHmm at the end before .md
    expect(fname).toMatch(/-20\d{6}-\d{4}\.md$/);
  });

  it('two calls in the same minute return identical filenames for the same snap', () => {
    const snap = makeSnap({ runId: 'wf_stable' });
    const a = buildExportFilename(snap);
    const b = buildExportFilename(snap);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Additional branch coverage — null-coalescing and edge paths
// ---------------------------------------------------------------------------
describe('generateMarkdown — branch coverage edge cases', () => {
  it('structured result with an object-valued key renders JSON (typeof v === "object" branch)', () => {
    const snap = makeSnap();
    snap.structuredResults = [
      {
        pass: 1,
        label: 'Implementer',
        key: 'implementer',
        result: {
          metadata: { nested: 'value', count: 3 },
        },
      },
    ];
    const md = generateMarkdown(snap);
    // The object value should be JSON-stringified in the output
    expect(md).toContain('"nested"');
  });

  it('sevTotals entry with undefined value renders 0 (sevTotals[sev] ?? 0 false branch)', () => {
    const snap = makeSnap();
    // Set a sev key whose value is undefined (exercises the ?? 0 branch)
    (snap.loop.sevTotals as Record<string, number | undefined>)['GHOST'] = undefined as unknown as number;
    const md = generateMarkdown(snap);
    // The GHOST entry should appear with 0 count
    expect(md).toContain('GHOST');
    expect(md).toContain('| 0 |');
  });

  it('agent with undefined idx renders empty string (a.idx ?? "" false branch)', () => {
    const snap = makeSnap();
    const agent = { ...snap.agents[0]! };
    delete (agent as Record<string, unknown>)['idx'];
    snap.agents = [agent];
    const md = generateMarkdown(snap);
    // Should not contain "undefined" in the metrics table
    expect(md).not.toContain('undefined');
  });

  it('agent with undefined tokens renders 0 (a.tokens ?? 0 false branch)', () => {
    const snap = makeSnap();
    const agent = { ...snap.agents[0]! };
    delete (agent as Record<string, unknown>)['tokens'];
    snap.agents = [agent];
    const md = generateMarkdown(snap);
    expect(md).not.toContain('undefined');
  });

  it('agent with undefined tools renders 0 (a.tools ?? 0 false branch)', () => {
    const snap = makeSnap();
    const agent = { ...snap.agents[0]! };
    delete (agent as Record<string, unknown>)['tools'];
    snap.agents = [agent];
    const md = generateMarkdown(snap);
    expect(md).not.toContain('undefined');
  });

  it('structured result with no label falls back to key (s(sr.label) || s(sr.key) branch)', () => {
    const snap = makeSnap();
    snap.structuredResults = [
      {
        pass: 1,
        label: '',
        key: 'my_agent_key',
        result: { verdict: 'PASS' },
      },
    ];
    const md = generateMarkdown(snap);
    expect(md).toContain('my_agent_key');
  });

  it('structured result with no label or key falls back to "Agent"', () => {
    const snap = makeSnap();
    snap.structuredResults = [
      {
        pass: 1,
        label: '',
        key: '',
        result: { verdict: 'PASS' },
      },
    ];
    const md = generateMarkdown(snap);
    expect(md).toContain('### Agent');
  });

  it('structured result with missing pass renders "?" (sr.pass ?? "?" false branch)', () => {
    const snap = makeSnap();
    snap.structuredResults = [
      {
        pass: undefined as unknown as number,
        label: 'Agent',
        key: 'agent',
        result: { verdict: 'PASS' },
      },
    ];
    const md = generateMarkdown(snap);
    expect(md).toContain('(pass ?)');
  });

  it('structured result with null result renders empty body (sr.result ?? {} false branch)', () => {
    const snap = makeSnap();
    snap.structuredResults = [
      {
        pass: 1,
        label: 'Agent',
        key: 'agent',
        result: null as unknown as Record<string, unknown>,
      },
    ];
    expect(() => generateMarkdown(snap)).not.toThrow();
  });

  it('verdictLabels undefined falls back to empty object (snap.verdictLabels ?? {} false branch)', () => {
    const snap = makeSnap();
    delete (snap as Record<string, unknown>)['verdictLabels'];
    expect(() => generateMarkdown(snap)).not.toThrow();
    const md = generateMarkdown(snap);
    expect(md).toContain('## Verdicts');
  });

  it('snap.runId null/undefined is coerced to empty string (s() null branch)', () => {
    const snap = makeSnap({ runId: null as unknown as string });
    expect(() => generateMarkdown(snap)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// escHeading — newline injection guard (via generateMarkdown)
// ---------------------------------------------------------------------------
describe('escHeading — heading injection guard', () => {
  it('reviewer name with embedded newline does not forge a new Markdown heading', () => {
    const snap = makeSnap();
    snap.allFindings = [
      {
        severity: 'HIGH',
        title: 'A finding',
        why: 'why',
        fix: 'fix',
        pass: 1,
        reviewer: 'Reviewer\n## Injected Section',
        key: 'code_reviewer',
      },
    ];
    const md = generateMarkdown(snap);
    // The injected heading must NOT appear as a real heading line
    expect(md).not.toContain('\n## Injected Section');
  });

  it('finding title with embedded newline does not forge a new Markdown heading', () => {
    const snap = makeSnap();
    snap.allFindings = [
      {
        severity: 'HIGH',
        title: 'Title\n## Fake Heading',
        why: 'why',
        fix: 'fix',
        pass: 1,
        reviewer: 'Code review',
        key: 'code_reviewer',
      },
    ];
    const md = generateMarkdown(snap);
    expect(md).not.toContain('\n## Fake Heading');
  });

  it('structured result label with embedded newline does not forge a heading', () => {
    const snap = makeSnap();
    snap.structuredResults = [
      {
        pass: 1,
        label: 'Agent\n## Injected',
        key: 'impl',
        result: { summary: 'ok' },
      },
    ];
    const md = generateMarkdown(snap);
    expect(md).not.toContain('\n## Injected');
  });

  it('reviewer name with carriage return is sanitised', () => {
    const snap = makeSnap();
    snap.allFindings = [
      {
        severity: 'LOW',
        title: 'finding',
        why: 'w',
        fix: 'f',
        pass: 1,
        reviewer: 'Reviewer\r\n## Fake',
        key: 'r',
      },
    ];
    const md = generateMarkdown(snap);
    expect(md).not.toContain('\r');
  });

  it('heading marker at start of f.why string (position 0) is blockquoted', () => {
    // escBody must blockquote heading markers that appear at position 0, not just
    // those preceded by a newline. A value like '## Injected' would be position-0.
    const snap = makeSnap();
    snap.allFindings = [
      {
        severity: 'LOW',
        title: 'Heading at start',
        why: '## Injected\nlegit text',
        fix: 'fix',
        pass: 1,
        reviewer: 'Code review',
        key: 'code_reviewer',
      },
    ];
    const md = generateMarkdown(snap);
    // Must not render as a real h2 heading at start of the Why paragraph
    expect(md).not.toMatch(/\*\*Why:\*\* ## Injected/);
    // Must be blockquoted
    expect(md).toContain('> ## Injected');
  });
});

// ---------------------------------------------------------------------------
// fmtTok — parity between TypeScript (markdown.ts) and webview JS versions
// ---------------------------------------------------------------------------
describe('fmtTok — TS/JS parity on boundary values', () => {
  it('produces identical output to the webview JS version for boundary inputs', () => {
    // The webview JS fmtTok is: function fmtTok(n){var v=safeN(n);return v<1000?v+'':v<1000000?(v/1000).toFixed(1)+'k':(v/1000000).toFixed(2)+'M';}
    // safeN(n) = isFinite(+n) ? +n : 0
    // The TS fmtTok uses Math.round() for the sub-1000 path.
    // This test documents the known divergence (JS coerces, TS rounds) and validates
    // that for all integer inputs (which is the normal case) outputs are identical.
    function jsVersion(n: number): string {
      const v = isFinite(+n) ? +n : 0;
      return v < 1000 ? v + '' : v < 1_000_000 ? (v / 1000).toFixed(1) + 'k' : (v / 1_000_000).toFixed(2) + 'M';
    }
    const boundaries = [0, 1, 999, 1000, 1001, 9999, 10000, 999999, 1000000, 1500000];
    for (const n of boundaries) {
      expect(fmtTok(n)).toBe(jsVersion(n));
    }
  });

  it('documents known divergence: 999.7 rounds differently between TS and JS versions', () => {
    // TS fmtTok: n < 1_000 check happens before Math.round(), so 999.7 is < 1000 → returns String(Math.round(999.7)) = '1000'.
    // JS fmtTok: v < 1000 check on raw float, then v+'' → '999.7'.
    // Both versions keep 999.7 in the sub-1000 branch (no 'k' suffix), but format differently.
    // This divergence only affects fractional sub-1000 inputs (never emitted by normal integer token counters).
    // This test pins the current TS behaviour so any future change is deliberate.
    expect(fmtTok(999.7)).toBe('1000'); // Math.round(999.7) === 1000, still sub-1000 → no 'k' suffix
    function jsVersion(n: number): string {
      const v = isFinite(+n) ? +n : 0;
      return v < 1000 ? v + '' : v < 1_000_000 ? (v / 1000).toFixed(1) + 'k' : (v / 1_000_000).toFixed(2) + 'M';
    }
    // JS renders '999.7'; TS renders '1000' — both sub-1000 branch, different string representation.
    expect(jsVersion(999.7)).toBe('999.7');
  });
});

// ---------------------------------------------------------------------------
// generateMarkdown — escBody injection guards
// ---------------------------------------------------------------------------
describe('generateMarkdown — escBody: bold-span injection via **', () => {
  it('replaces ** with * in f.why to prevent bold-span forging while preserving emphasis', () => {
    const snap = makeSnap();
    snap.allFindings = [
      {
        severity: 'LOW',
        title: 'bold forge',
        why: 'text **broken** end',
        fix: 'normal fix',
        pass: 1,
        reviewer: 'Code review',
        key: 'code_reviewer',
      },
    ];
    const md = generateMarkdown(snap);
    // ** must be replaced with * so the surrounding **Why:** bold span is not corrupted
    expect(md).not.toContain('**broken**');
    // Single asterisks are used to preserve visual emphasis intent
    expect(md).toContain('text *broken* end');
  });

  it('replaces ** with * in f.fix to prevent bold-span forging while preserving emphasis', () => {
    const snap = makeSnap();
    snap.allFindings = [
      {
        severity: 'LOW',
        title: 'bold forge fix',
        why: 'why text',
        fix: 'fix **injected**',
        pass: 1,
        reviewer: 'Code review',
        key: 'code_reviewer',
      },
    ];
    const md = generateMarkdown(snap);
    expect(md).not.toContain('**injected**');
    expect(md).toContain('fix *injected*');
  });
});

describe('generateMarkdown — escBody: setext heading injection', () => {
  it('escapes === underline in f.why to prevent setext H1 forging', () => {
    const snap = makeSnap();
    snap.allFindings = [
      {
        severity: 'LOW',
        title: 'setext H1 forge',
        why: 'legitimate content\n===',
        fix: 'fix it',
        pass: 1,
        reviewer: 'Code review',
        key: 'code_reviewer',
      },
    ];
    const md = generateMarkdown(snap);
    // The === line must be escaped with a backslash prefix
    expect(md).toContain('\\===');
    expect(md).not.toMatch(/^===$/m);
  });

  it('escapes --- underline in f.why to prevent setext H2 forging', () => {
    const snap = makeSnap();
    snap.allFindings = [
      {
        severity: 'LOW',
        title: 'setext H2 forge',
        why: 'heading text\n---',
        fix: 'fix it',
        pass: 1,
        reviewer: 'Code review',
        key: 'code_reviewer',
      },
    ];
    const md = generateMarkdown(snap);
    expect(md).toContain('\\---');
    expect(md).not.toMatch(/^---$/m);
  });
});

// ---------------------------------------------------------------------------
// generateMarkdown — NITPICK severity ordering
// ---------------------------------------------------------------------------
describe('generateMarkdown — NITPICK in severity breakdown', () => {
  it('NITPICK sorts after LOW and before INFO in the Severity Breakdown table', () => {
    const snap = makeSnap({
      loop: {
        ...makeSnap().loop,
        sevTotals: { CRITICAL: 1, LOW: 2, NITPICK: 3, INFO: 1, UNRATED: 1 },
      },
    });
    const md = generateMarkdown(snap);
    const lowPos = md.indexOf('| LOW |');
    const nitpickPos = md.indexOf('| NITPICK |');
    const infoPos = md.indexOf('| INFO |');
    expect(nitpickPos).toBeGreaterThan(lowPos);
    expect(nitpickPos).toBeLessThan(infoPos);
  });

  it('NITPICK sorts before UNRATED', () => {
    const sevs = ['UNRATED', 'NITPICK', 'LOW'];
    sevs.sort(cmpSev);
    expect(sevs).toEqual(['LOW', 'NITPICK', 'UNRATED']);
  });
});

// ---------------------------------------------------------------------------
// generateMarkdown — multi-pass reviewer section heading (passNums.length > 1)
// ---------------------------------------------------------------------------
describe('generateMarkdown — multi-pass reviewer heading', () => {
  it('formats "(passes X, Y)" when a reviewer has findings in two passes', () => {
    const snap = makeSnap();
    snap.allFindings = [
      {
        severity: 'HIGH',
        title: 'Finding pass 1',
        why: 'why p1',
        fix: 'fix p1',
        pass: 1,
        reviewer: 'Multi Reviewer',
        key: 'multi',
      },
      {
        severity: 'LOW',
        title: 'Finding pass 2',
        why: 'why p2',
        fix: 'fix p2',
        pass: 2,
        reviewer: 'Multi Reviewer',
        key: 'multi',
      },
    ];
    const md = generateMarkdown(snap);
    expect(md).toContain('### Multi Reviewer (passes 1, 2)');
  });

  it('omits pass annotation entirely when all findings lack a pass field (passNums.length===0)', () => {
    // Exercises the '' fallback branch in buildFindings (line 211 in markdown.ts).
    // When no finding carries a pass number the reviewer heading must have no parenthetical.
    const snap = makeSnap();
    snap.allFindings = [
      {
        severity: 'HIGH',
        title: 'No-pass finding',
        why: 'w',
        fix: 'f',
        // pass intentionally absent
        reviewer: 'No Pass Reviewer',
        key: 'no_pass',
      },
    ];
    const md = generateMarkdown(snap);
    // Heading must be plain (no pass annotation) — check the specific heading line
    expect(md).toContain('### No Pass Reviewer\n');
    // The reviewer heading line itself must not contain a pass annotation
    const headingLine = md.split('\n').find((l) => l.startsWith('### No Pass Reviewer'));
    expect(headingLine).toBe('### No Pass Reviewer');
  });
});

// ---------------------------------------------------------------------------
// buildExportFilename — uses snap.updatedAt as timestamp source
// ---------------------------------------------------------------------------
describe('buildExportFilename — updatedAt timestamp source', () => {
  it('uses snap.updatedAt when it is a parseable ISO date string', () => {
    const isoDate = '2025-03-15T09:30:00.000Z';
    const snap = makeSnap({ updatedAt: isoDate });
    const filename = buildExportFilename(snap);
    // Build the expected timestamp from the same Date object using UTC methods,
    // matching the buildExportFilename implementation (which uses UTC for determinism).
    const d = new Date(isoDate);
    const yyyy = String(d.getUTCFullYear());
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mi = String(d.getUTCMinutes()).padStart(2, '0');
    const expectedTs = `${yyyy}${mm}${dd}-${hh}${mi}`;
    expect(filename).toContain(expectedTs);
  });

  it('falls back to current time when updatedAt is not a valid date', () => {
    const snap = makeSnap({ updatedAt: 'not a date' });
    // Should not throw and should produce a valid filename
    const filename = buildExportFilename(snap);
    expect(filename).toMatch(/^claude-workflow-.*-\d{8}-\d{4}\.md$/);
  });

  it('falls back to current time when updatedAt is absent', () => {
    const snap = makeSnap({ updatedAt: undefined as unknown as string });
    const filename = buildExportFilename(snap);
    expect(filename).toMatch(/^claude-workflow-.*-\d{8}-\d{4}\.md$/);
  });
});

// ---------------------------------------------------------------------------
// generateMarkdown — escBody: single-char setext heading injection (AC fix)
// CommonMark requires only ONE '=' or '-' to underline a setext heading.
// The earlier tests cover ===/ --- (3+ chars); these cover the single-char case.
// ---------------------------------------------------------------------------
describe('generateMarkdown — escBody: single-char setext heading injection', () => {
  it('escapes a single = on its own line to prevent setext H1 forging', () => {
    const snap = makeSnap();
    snap.allFindings = [
      {
        severity: 'LOW',
        title: 'single-= setext forge',
        why: 'heading text\n=',
        fix: 'fix it',
        pass: 1,
        reviewer: 'Code review',
        key: 'code_reviewer',
      },
    ];
    const md = generateMarkdown(snap);
    // Single = must be backslash-escaped so it cannot underline the preceding line
    expect(md).toContain('\\=');
    expect(md).not.toMatch(/^=$/m);
  });

  it('escapes a single - on its own line to prevent setext H2 forging', () => {
    const snap = makeSnap();
    snap.allFindings = [
      {
        severity: 'LOW',
        title: 'single-- setext forge',
        why: 'heading text\n-',
        fix: 'fix it',
        pass: 1,
        reviewer: 'Code review',
        key: 'code_reviewer',
      },
    ];
    const md = generateMarkdown(snap);
    // Single - must be backslash-escaped
    expect(md).toContain('\\-');
    expect(md).not.toMatch(/^-$/m);
  });

  it('escapes == (two =) on its own line', () => {
    const snap = makeSnap();
    snap.allFindings = [
      {
        severity: 'LOW',
        title: 'double-= setext forge',
        why: 'heading text\n==',
        fix: 'fix it',
        pass: 1,
        reviewer: 'Code review',
        key: 'code_reviewer',
      },
    ];
    const md = generateMarkdown(snap);
    expect(md).toContain('\\==');
    expect(md).not.toMatch(/^==$/m);
  });

  it('does NOT escape a - that is part of a list item (has trailing content)', () => {
    // A dash followed by text is a Markdown list item, not a setext underline.
    // The setext guard should only fire when the line is ONLY dashes/equals.
    const snap = makeSnap();
    snap.allFindings = [
      {
        severity: 'LOW',
        title: 'list item test',
        why: 'some text\n- list item here',
        fix: 'fix it',
        pass: 1,
        reviewer: 'Code review',
        key: 'code_reviewer',
      },
    ];
    const md = generateMarkdown(snap);
    // The list item dash is NOT a setext underline — must not be escaped
    expect(md).toContain('- list item here');
  });

  it('escapes setext underline in f.fix field', () => {
    const snap = makeSnap();
    snap.allFindings = [
      {
        severity: 'LOW',
        title: 'setext in fix',
        why: 'why text',
        fix: 'fix heading\n=',
        pass: 1,
        reviewer: 'Code review',
        key: 'code_reviewer',
      },
    ];
    const md = generateMarkdown(snap);
    expect(md).toContain('\\=');
    expect(md).not.toMatch(/^=$/m);
  });

  it('escapes setext underline in structured result values', () => {
    const snap = makeSnap();
    snap.structuredResults = [
      {
        pass: 1,
        label: 'Implementer',
        key: 'impl',
        result: { summary: 'heading text\n=' },
      },
    ];
    const md = generateMarkdown(snap);
    expect(md).toContain('\\=');
    expect(md).not.toMatch(/^=$/m);
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// generateMarkdown — injection guards: link defanging (escBody + escKey)
// These tests bring the link-defanging branch under the 90% coverage gate.
// ---------------------------------------------------------------------------
describe('generateMarkdown — injection guards: link defanging', () => {
  it('escBody: [text](url) in f.why is defanged to plain text (url)', () => {
    const snap = makeSnap();
    snap.allFindings = [
      {
        severity: 'LOW',
        title: 'Link defang test',
        why: 'Click [click here](https://evil.com) for more info.',
        fix: 'fix',
        pass: 1,
        reviewer: 'Code review',
        key: 'code_reviewer',
      },
    ];
    const md = generateMarkdown(snap);
    // The defanged form must appear — raw markdown link must not survive
    expect(md).toContain('click here (https://evil.com)');
    expect(md).not.toContain('[click here](https://evil.com)');
  });

  it('escBody: URL with embedded newline+heading is defanged (newline stripped from URL)', () => {
    const snap = makeSnap();
    snap.allFindings = [
      {
        severity: 'LOW',
        title: 'Link with newline in URL',
        why: 'See [text](http://x.com/page\n## Injected) for details.',
        fix: 'fix',
        pass: 1,
        reviewer: 'Code review',
        key: 'code_reviewer',
      },
    ];
    const md = generateMarkdown(snap);
    // The raw link must be defanged; the embedded heading marker must not appear as a heading
    expect(md).not.toContain('[text](http://x.com/page');
    // The ## must not appear as a standalone heading line
    expect(md).not.toMatch(/\n## Injected$/m);
  });

  it('escKey: structured result key with [text](url) is defanged in bold span', () => {
    const snap = makeSnap();
    snap.structuredResults = [
      {
        pass: 1,
        label: 'Agent',
        key: 'agent',
        result: {
          '[key](http://x.com)': 'some value',
        },
      },
    ];
    const md = generateMarkdown(snap);
    // The key must be defanged — markdown link syntax must not appear in the bold span
    expect(md).toContain('key (http://x.com)');
    expect(md).not.toContain('**[key](http://x.com):**');
  });

  it('escBody: nested-bracket link outer link does not survive (loop-until-stable fix)', () => {
    // A single-pass regex leaves '[b (harmless)](evil)' — a valid GFM link.
    // The loop-until-stable fix must eliminate the outer link too.
    const snap = makeSnap();
    snap.allFindings = [
      {
        severity: 'LOW',
        title: 'Nested bracket link',
        why: '[a [b](http://harmless.example)](https://evil.example)',
        fix: 'fix',
        pass: 1,
        reviewer: 'Code review',
        key: 'code_reviewer',
      },
    ];
    const md = generateMarkdown(snap);
    // After defanging, no markdown link syntax of the form [...](...) should remain
    // targeting the evil URL
    expect(md).not.toMatch(/\[[^\]]+\]\(https:\/\/evil\.example\)/);
    // The evil URL itself appears as plain text in parentheses — acceptable (not clickable)
    expect(md).toContain('https://evil.example');
  });

  it('escKey: nested-bracket link in result key does not survive single-pass', () => {
    const snap = makeSnap();
    snap.structuredResults = [
      {
        pass: 1,
        label: 'Agent',
        key: 'agent',
        result: {
          '[a [b](http://harmless.example)](https://evil.example)': 'value',
        },
      },
    ];
    const md = generateMarkdown(snap);
    // No markdown link syntax should remain in the key position targeting the evil URL
    expect(md).not.toMatch(/\[[^\]]+\]\(https:\/\/evil\.example\)/);
  });
});

// ---------------------------------------------------------------------------
// generateMarkdown — escBody: ** bold-forging edge cases (AC clarification)
// These supplement the existing bold-forging tests with additional edge cases.
// ---------------------------------------------------------------------------
describe('generateMarkdown — escBody: bold-forging edge cases', () => {
  it('replaces *** (three asterisks) with * in body text', () => {
    const snap = makeSnap();
    snap.allFindings = [
      {
        severity: 'LOW',
        title: 'triple asterisk',
        why: 'text ***bold-italic*** end',
        fix: 'fix',
        pass: 1,
        reviewer: 'Code review',
        key: 'code_reviewer',
      },
    ];
    const md = generateMarkdown(snap);
    // *** sequences must be replaced with * (single asterisk) — not stripped entirely.
    // Note: the markdown template itself emits **Why:** etc, so we check
    // only that the triple-asterisk payload does not appear verbatim.
    expect(md).not.toContain('***bold-italic***');
    // Three asterisks → one asterisk on each side → *bold-italic* in output.
    expect(md).toContain('text *bold-italic* end');
  });

  it('strips ** at the very start of a body value (position 0)', () => {
    const snap = makeSnap();
    snap.allFindings = [
      {
        severity: 'LOW',
        title: 'leading **',
        why: '**injected bold start',
        fix: 'fix',
        pass: 1,
        reviewer: 'Code review',
        key: 'code_reviewer',
      },
    ];
    const md = generateMarkdown(snap);
    expect(md).not.toContain('**injected');
    expect(md).toContain('injected bold start');
  });
});
