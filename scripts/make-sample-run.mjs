/**
 * make-sample-run.mjs — deterministic wf_* fixture generator for M4 screenshots.
 *
 * Writes a realistic wf_* directory to <outDir>/wf_screenshot_fixture/ with:
 *   - A multi-pass review (code-reviewer, security-reviewer) with mixed-severity findings
 *   - A verify agent with a structured result
 *   - Two live agents mid-tool-call (run status)
 *   - A dead agent (stalled, no result)
 *   - A superseded zombie + its retry (to exercise M3 superseded detection)
 *   - An implementer with a filesChanged result
 *
 * All timestamps are derived from a fixed BASE_TIME so the fixture is fully
 * deterministic: same invocation → same bytes on disk → same screenshot pixels.
 *
 * Usage:
 *   node scripts/make-sample-run.mjs [outDir]
 * Defaults outDir to .review-tmp/fixture-run.
 *
 * Exported (as named export) for use in tests:
 *   import { makeSampleRun } from './scripts/make-sample-run.mjs';
 *   const dir = makeSampleRun('/tmp/my-fixture');
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Fixed base time — 2025-03-15T10:00:00Z in Unix seconds.
// Historical agent start/mtime values are offsets from this base.
// ---------------------------------------------------------------------------
export const BASE_TIME_SECS = 1742032800;

// Exported for screenshot.mjs, which injects it as window._FAKE_NOW_SECS so
// timelinePanel() produces deterministic bar widths for 'run' agents. Without it,
// live-agent bars extend to the real wall-clock 'now', making timeline screenshots
// non-deterministic across machines. Also used by tests that verify the fixed epoch.
export const FAKE_NOW_SECS = BASE_TIME_SECS + 3600;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write each element of `rows` as a JSON line to `filePath`. */
function writeJsonl(filePath, rows) {
  const content = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(filePath, content, 'utf8');
}

/** Write a single JSON object to `filePath`. */
function writeJson(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/**
 * Touch a file's mtime to a specific Unix-second timestamp.
 * Used to set agent transcript mtimes without platform-specific tricks.
 */
function setMtime(filePath, timeSecs) {
  const t = new Date(timeSecs * 1000);
  fs.utimesSync(filePath, t, t);
}

// ---------------------------------------------------------------------------
// Agent transcript builders
// ---------------------------------------------------------------------------

/**
 * Build a code-reviewer transcript (pass 1): findings with HIGH, MEDIUM, LOW.
 * Produces a structured result with findings and a verdict.
 */
function codeReviewerPass1Events(baseTime) {
  return [
    {
      type: 'user',
      message: {
        content: 'You are a code reviewer. Review the implementation for correctness, ' +
          'maintainability, and potential bugs. Focus on src/data/snapshot.ts.',
      },
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read', input: { path: 'src/data/snapshot.ts' } },
          { type: 'text', text: 'Reading the snapshot module…' },
        ],
        usage: { output_tokens: 180 },
      },
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read', input: { path: 'src/data/parse.ts' } },
          { type: 'text', text: 'Reading the parse module…' },
        ],
        usage: { output_tokens: 140, input_tokens: 3200, cache_read_input_tokens: 800 },
      },
    },
    {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Analysis complete. Found 4 issues.' }],
        usage: { output_tokens: 520, input_tokens: 4800, cache_read_input_tokens: 1200 },
      },
    },
  ];
}

/**
 * Build a security-reviewer transcript (pass 1): security-focused findings.
 */
function securityReviewerPass1Events() {
  return [
    {
      type: 'user',
      message: {
        content: 'You are a security reviewer. Audit the implementation for ' +
          'injection, path traversal, and information-disclosure vulnerabilities.',
      },
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Bash', input: { command: 'grep -r "innerHTML" src/' } },
          { type: 'text', text: 'Checking for unsafe innerHTML usage…' },
        ],
        usage: { output_tokens: 95, input_tokens: 2100 },
      },
    },
    {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Security audit complete. 2 issues found.' }],
        usage: { output_tokens: 380, input_tokens: 3400 },
      },
    },
  ];
}

/**
 * Implementer transcript — Round 1: fixes findings from pass 1 reviews.
 */
function implementerEvents() {
  return [
    {
      type: 'user',
      message: {
        content: 'You are Fritz, a senior developer. Fix all findings from the ' +
          'code review and security review. See the findings list below:\n' +
          '[findings JSON embedded here]',
      },
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read', input: { path: 'src/data/snapshot.ts' } },
        ],
        usage: { output_tokens: 120, input_tokens: 5000, cache_creation_input_tokens: 2000 },
      },
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Edit', input: { path: 'src/data/snapshot.ts', old_string: 'x', new_string: 'y' } },
        ],
        usage: { output_tokens: 310, input_tokens: 5200, cache_read_input_tokens: 2000 },
      },
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
          { type: 'text', text: 'Running tests…' },
        ],
        usage: { output_tokens: 240, input_tokens: 5400, cache_read_input_tokens: 2000 },
      },
    },
    {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'All fixes applied. Tests pass.' }],
        usage: { output_tokens: 180, input_tokens: 5100, cache_read_input_tokens: 2000 },
      },
    },
  ];
}

/**
 * Code-reviewer pass 2 — shorter, only LOW findings remain.
 */
function codeReviewerPass2Events() {
  return [
    {
      type: 'user',
      message: {
        content: 'You are a code reviewer (round 2). Re-review after the implementer ' +
          'fixed the previous findings. Verify all HIGH/MEDIUM are resolved.',
      },
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read', input: { path: 'src/data/snapshot.ts' } },
        ],
        usage: { output_tokens: 110, input_tokens: 3800 },
      },
    },
    {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'HIGH and MEDIUM issues are resolved. Minor nit remains.' }],
        usage: { output_tokens: 195, input_tokens: 3900 },
      },
    },
  ];
}

/**
 * Verify agent — test-verifier with a structured buildOk/testsOk result.
 */
function verifyEvents() {
  return [
    {
      type: 'user',
      message: {
        content: 'You are the test verifier. Run the full test suite and report results.',
      },
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Bash', input: { command: 'npm run build' } },
        ],
        usage: { output_tokens: 55, input_tokens: 1200 },
      },
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
        ],
        usage: { output_tokens: 62, input_tokens: 1400 },
      },
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Bash', input: { command: 'npm run lint' } },
        ],
        usage: { output_tokens: 48, input_tokens: 1500 },
      },
    },
    {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'All checks passed.' }],
        usage: { output_tokens: 140, input_tokens: 1600 },
      },
    },
  ];
}

/**
 * Dead agent — stalled mid-run with no result.
 */
function deadAgentEvents() {
  return [
    {
      type: 'user',
      message: {
        content: 'You are a completeness critic. Audit the implementation for missing edge cases.',
      },
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read', input: { path: 'src/data/snapshot.ts' } },
        ],
        usage: { output_tokens: 88, input_tokens: 2000 },
      },
    },
  ];
}

/**
 * Superseded zombie — a dead agent with no result and short elapsed, shadowed
 * by the retry agent that started later with the same agentType/key.
 */
function zombieEvents() {
  return [
    {
      type: 'user',
      message: {
        content: 'You are a UI/UX reviewer. Review the dashboard UI for accessibility and usability.',
      },
    },
    {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Starting UI/UX review…' }],
        usage: { output_tokens: 30 },
      },
    },
  ];
}

/**
 * Retry agent — the survivor that superseded the zombie above (same agentType).
 */
function retryUiuxEvents() {
  return [
    {
      type: 'user',
      message: {
        content: 'You are a UI/UX reviewer (retry). Review the dashboard UI for accessibility and usability.',
      },
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read', input: { path: 'src/webview/html.ts' } },
        ],
        usage: { output_tokens: 95, input_tokens: 2500 },
      },
    },
    {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'UI/UX review complete. 1 issue found.' }],
        usage: { output_tokens: 270, input_tokens: 2800 },
      },
    },
  ];
}

/**
 * Live agent 1 — mid-tool-call (run status, recent mtime).
 */
function liveAgent1Events() {
  return [
    {
      type: 'user',
      message: {
        content: 'You are an architect. Design the M5 dependency-graph data structure.',
      },
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'WebSearch', input: { query: 'DAG layout algorithms' } },
          { type: 'text', text: 'Researching graph layout strategies…' },
        ],
        usage: { output_tokens: 145, input_tokens: 1800 },
      },
    },
  ];
}

/**
 * Live agent 2 — another live agent, also mid-tool-call.
 */
function liveAgent2Events() {
  return [
    {
      type: 'user',
      message: {
        content: 'You are a second implementer applying the final nit-fix from round 2.',
      },
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Edit', input: { path: 'src/data/parse.ts', old_string: 'a', new_string: 'b' } },
        ],
        usage: { output_tokens: 88, input_tokens: 2200 },
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Result objects (stored in journal.jsonl)
// ---------------------------------------------------------------------------

const CODE_REVIEW_PASS1_RESULT = {
  verdict: 'NEEDS WORK — 4 findings (1 HIGH, 2 MEDIUM, 1 LOW)',
  findings: [
    {
      severity: 'HIGH',
      title: 'Path traversal in agent file read',
      location: 'src/data/snapshot.ts:281',
      why: 'The agent id extracted from the filename is not validated against path-traversal sequences before being used in fs.readFileSync; a crafted filename like agent-../../../etc/passwd.jsonl could escape the wf_* directory.',
      fix: 'Reject any aid containing "/" or ".." before constructing the meta path (guard already exists for ".." but not "/" on POSIX). Add the "/" check.',
      category: 'security',
    },
    {
      severity: 'MEDIUM',
      title: 'STALE_SECS constant duplicated across modules',
      location: 'src/data/parse.ts:3, src/data/snapshot.ts:32',
      why: 'STALE_SECS = 180 is defined once in parse.ts and re-imported; however, SUPERSEDED_MAX_ELAPSED_SECS appears nearby without a reference comment linking them. Future editors may diverge the two silently.',
      fix: 'Add a comment above SUPERSEDED_MAX_ELAPSED_SECS referencing STALE_SECS and explaining why they differ.',
      category: 'maintainability',
    },
    {
      severity: 'MEDIUM',
      title: 'agentsCapped path lacks unit test',
      location: 'src/data/snapshot.ts:258',
      why: 'The branch that stat-sorts and slices to MAX_AGENTS is marked c8 ignore — impractical in unit tests — but at least a mock-based integration test should verify the cap logic.',
      fix: 'Add a test that creates >200 stub agent files in a temp dir and asserts agentsCapped is true and agents.length === MAX_AGENTS.',
      category: 'test-coverage',
    },
    {
      severity: 'LOW',
      title: 'Nit: `const` destructure `let`',
      location: 'src/data/snapshot.ts:195',
      why: '`let wfDir` is immediately assigned and never reassigned after the branch — `const` would be clearer.',
      fix: 'Refactor the branching to use `const wfDir`.',
      category: 'style',
    },
  ],
};

const SECURITY_REVIEW_PASS1_RESULT = {
  verdict: 'NEEDS WORK — 2 findings (1 HIGH, 1 MEDIUM)',
  findings: [
    {
      severity: 'HIGH',
      title: 'Unescaped agent prompt injected into webview innerHTML',
      location: 'src/webview/html.ts',
      why: 'The `prompt` field from the snapshot is rendered into the webview via innerHTML without escaping. An agent whose prompt contains `<script>` could execute arbitrary JS in the webview context.',
      fix: 'Pass every prompt field through `esc()` before HTML injection.',
      category: 'xss',
    },
    {
      severity: 'MEDIUM',
      title: 'OutputChannel path disclosed in error notification',
      location: 'src/extension.ts',
      why: 'The catch branch in activate() calls showErrorMessage with a raw error string that may contain the full filesystem path of the extension host.',
      fix: 'Redact path segments from the error string (same pattern as buildSnapshot\'s outer catch) before surfacing in showErrorMessage.',
      category: 'information-disclosure',
    },
  ],
};

const UIUX_REVIEW_RESULT = {
  verdict: 'NEEDS WORK — 1 finding (MEDIUM)',
  findings: [
    {
      severity: 'MEDIUM',
      title: 'Tab keyboard navigation missing Home/End key handlers',
      location: 'src/webview/js-wire.ts',
      why: 'The WAI-ARIA tabs pattern requires ArrowLeft/Right AND Home/End key support. Home/End are not wired in the current keydown handler, failing the WCAG 2.1 criterion.',
      fix: 'Add Home → activate first tab and End → activate last tab in the keydown handler.',
      category: 'accessibility',
    },
  ],
};

const CODE_REVIEW_PASS2_RESULT = {
  verdict: 'APPROVED — 0 HIGH/MEDIUM, 1 LOW nit (may land as-is)',
  findings: [
    {
      severity: 'LOW',
      title: 'Comment missing on SUPERSEDED_MAX_ELAPSED_SECS cross-ref',
      location: 'src/data/snapshot.ts:32',
      why: 'The M2 fix added a comment but it does not yet explain WHY the threshold is 120 s (the implementer\'s minimum realistic run time). Future editors may reduce it incorrectly.',
      fix: 'Extend the comment: "120 s is conservative — real implementer runs take several minutes; a crash-retry dies within seconds."',
      category: 'maintainability',
    },
  ],
};

const VERIFY_RESULT = {
  buildOk: true,
  lintOk: true,
  testsOk: true,
  failures: [],
  summary: 'Build, lint, and tests all passed. 147 tests, 0 failures. Coverage 91.3% on src/data/** (gate: 90%).',
};

const IMPLEMENTER_RESULT = {
  summary: '## Implementation: Fix code-review and security-review findings\n\n### What Was Built\nFixed 6 findings across 3 files. Path traversal guard added. esc() applied to prompt field. Error path redacted in activation. SUPERSEDED_MAX_ELAPSED_SECS comment extended.\n\n### Files Changed\n| File | Change |\n|------|--------|\n| src/data/snapshot.ts | Added "/" guard in aid validation; extended comment on SUPERSEDED_MAX_ELAPSED_SECS |\n| src/webview/html.ts | Wrapped prompt field in esc() before innerHTML injection |\n| src/extension.ts | Redacted path in showErrorMessage catch branch |\n\n### Test Results\nnpm test: 147 passed, 0 failed\n\n### Status\nCOMPLETE',
  filesChanged: [
    'src/data/snapshot.ts',
    'src/webview/html.ts',
    'src/extension.ts',
  ],
  testsRun: true,
  fixed: 6,
};

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic wf_* fixture directory.
 *
 * @param {string} outDir    Directory under which `wf_screenshot_fixture/` is written.
 * @param {number} [nowSecs] Unix timestamp for "now" (defaults to Date.now()/1000).
 *                           Callers may supply a fixed value to make live-agent mtimes
 *                           deterministic in controlled test environments, but note that
 *                           buildSnapshot uses real Date.now() internally so live-agent
 *                           status only reads as 'run' when nowSecs ≈ real time.
 * @returns {string}         Absolute path to the generated wf_* dir.
 */
export function makeSampleRun(outDir, nowSecs) {
  // Default to real current time so live agents appear live against buildSnapshot.
  const now = typeof nowSecs === 'number' ? nowSecs : Math.floor(Date.now() / 1000);

  const wfDir = path.resolve(outDir, 'wf_screenshot_fixture');
  fs.mkdirSync(wfDir, { recursive: true });

  // Agent ids — short, stable, descriptive.
  const IDS = {
    codeReviewer1:  'cr1review',
    securityReview: 'sec1review',
    implementer:    'impl1fix',
    codeReviewer2:  'cr2review',
    uiuxZombie:     'uiux1zombie',
    uiuxRetry:      'uiux2retry',
    verifier:       'verify1run',
    deadAgent:      'completeness1dead',
    live1:          'arch1live',
    live2:          'impl2live',
  };

  // Historical timeline (offsets from BASE_TIME_SECS — fixed, deterministic):
  //   t+0    cr1review starts
  //   t+10   sec1review starts
  //   t+300  cr1review done  (5 min)
  //   t+340  sec1review done
  //   t+360  impl1fix starts
  //   t+420  uiux1zombie starts (will be superseded ~30s later)
  //   t+450  uiux1zombie dies (30 s elapsed, no result — zombie)
  //   t+455  uiux2retry starts
  //   t+600  impl1fix done (4 min)
  //   t+610  cr2review starts
  //   t+620  verify1run starts
  //   t+630  completeness1dead starts
  //   t+660  uiux2retry done
  //   t+720  cr2review done
  //   t+750  verify1run done
  //   t+760  completeness1dead stalls (no result; far in the past → dead)
  //
  // Live agents: start and mtime are relative to `now` so they appear as
  // 'run' (mtime within STALE_SECS=180s) regardless of when the fixture runs.

  const T = BASE_TIME_SECS;
  const schedule = {
    [IDS.codeReviewer1]:  { start: T + 0,   mtime: T + 300 },
    [IDS.securityReview]: { start: T + 10,  mtime: T + 340 },
    [IDS.implementer]:    { start: T + 360, mtime: T + 600 },
    [IDS.uiuxZombie]:     { start: T + 420, mtime: T + 450 },  // 30 s elapsed — zombie
    [IDS.uiuxRetry]:      { start: T + 455, mtime: T + 660 },
    [IDS.codeReviewer2]:  { start: T + 610, mtime: T + 720 },
    [IDS.verifier]:       { start: T + 620, mtime: T + 750 },
    [IDS.deadAgent]:      { start: T + 630, mtime: T + 760 }, // far in the past → dead
    [IDS.live1]:          { start: now - 60, mtime: now - 30 }, // 30 s ago = alive (run)
    [IDS.live2]:          { start: now - 50, mtime: now - 20 }, // 20 s ago = alive (run)
  };

  // --- Write agent transcripts ---

  const agentDefs = [
    { id: IDS.codeReviewer1,  agentType: 'workflow-plugins:code-reviewer',       events: codeReviewerPass1Events(T) },
    { id: IDS.securityReview, agentType: 'workflow-plugins:security-reviewer',    events: securityReviewerPass1Events() },
    { id: IDS.implementer,    agentType: 'workflow-plugins:implementer',           events: implementerEvents() },
    { id: IDS.uiuxZombie,     agentType: 'workflow-plugins:uiux-reviewer',        events: zombieEvents() },
    { id: IDS.uiuxRetry,      agentType: 'workflow-plugins:uiux-reviewer',        events: retryUiuxEvents() },
    { id: IDS.codeReviewer2,  agentType: 'workflow-plugins:code-reviewer',        events: codeReviewerPass2Events() },
    { id: IDS.verifier,       agentType: 'workflow-plugins:test-verifier',        events: verifyEvents() },
    { id: IDS.deadAgent,      agentType: 'workflow-plugins:completeness-critic',  events: deadAgentEvents() },
    { id: IDS.live1,          agentType: 'workflow-plugins:architect',             events: liveAgent1Events() },
    { id: IDS.live2,          agentType: 'workflow-plugins:implementer',           events: liveAgent2Events() },
  ];

  for (const { id, agentType, events } of agentDefs) {
    const transcriptPath = path.join(wfDir, `agent-${id}.jsonl`);
    const metaPath       = path.join(wfDir, `agent-${id}.meta.json`);
    writeJsonl(transcriptPath, events);
    writeJson(metaPath, { agentType, agentId: id });
    const sched = schedule[id];
    setMtime(transcriptPath, sched.mtime);
    setMtime(metaPath,       sched.start);
  }

  // --- Write journal.jsonl ---

  // started events for all agents
  const journalRows = [
    ...Object.values(IDS).map((id) => ({ type: 'started', agentId: id })),
    // result events for completed agents only (no result for dead/live agents)
    { type: 'result', agentId: IDS.codeReviewer1,  result: CODE_REVIEW_PASS1_RESULT },
    { type: 'result', agentId: IDS.securityReview,  result: SECURITY_REVIEW_PASS1_RESULT },
    { type: 'result', agentId: IDS.implementer,     result: IMPLEMENTER_RESULT },
    { type: 'result', agentId: IDS.uiuxRetry,       result: UIUX_REVIEW_RESULT },
    { type: 'result', agentId: IDS.codeReviewer2,   result: CODE_REVIEW_PASS2_RESULT },
    { type: 'result', agentId: IDS.verifier,         result: VERIFY_RESULT },
    // Note: uiuxZombie, deadAgent, live1, live2 have NO result entries — intentional.
  ];
  const journalPath = path.join(wfDir, 'journal.jsonl');
  writeJsonl(journalPath, journalRows);
  // Set journal mtime to current "now" (latest activity time)
  setMtime(journalPath, now - 20);
  // Touch the wfDir itself to the latest mtime so discovery finds it as newest
  const wfDirTime = new Date((now - 15) * 1000);
  fs.utimesSync(wfDir, wfDirTime, wfDirTime);

  return wfDir;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const outDir = process.argv[2] || '.review-tmp/fixture-run';
  const wfDir = makeSampleRun(outDir);
  console.log('fixture written to:', wfDir);
}
