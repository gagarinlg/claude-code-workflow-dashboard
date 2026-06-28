/**
 * M2-Metrics — tests for optional token fields in agentStats/buildSnapshot/getHtml.
 *
 * Strategy: build synthetic fixtures in-memory/tmp to control exactly which
 * token fields appear so we can verify:
 *   - inTok/cacheCreate/cacheRead propagate when present in transcripts
 *   - they are absent (undefined) when not in transcripts — never 0-as-real
 *   - loop totals aggregate correctly
 *   - getHtml JS contains the rendering logic for these fields
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildSnapshot } from '../src/data/snapshot';
import { agentStats } from '../src/data/parse';
import { DEFAULT_ROLE_RULES } from '../src/data/parse';
import { getHtml } from '../src/webview/html';
import type { Cfg, SnapshotOk } from '../src/data/snapshot';

const TEST_NONCE = 'dGVzdG5vbmNlMTIz';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a minimal agent JSONL transcript to disk. */
function writeAgentTranscript(
  dir: string,
  agentId: string,
  events: unknown[],
): void {
  fs.writeFileSync(
    path.join(dir, `agent-${agentId}.jsonl`),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf8',
  );
}

/** Write a minimal journal with a single started+result event for an agent. */
function writeJournal(dir: string, agentId: string): void {
  const started = JSON.stringify({ type: 'started', agentId });
  const result = JSON.stringify({ type: 'result', agentId, result: 'done' });
  fs.writeFileSync(path.join(dir, 'journal.jsonl'), `${started}\n${result}\n`, 'utf8');
}

/** Build a Cfg pointing at a temporary wf_* dir. */
function makeCfg(base: string): Cfg {
  return {
    base,
    repo: '',
    refreshMs: 4000,
    statusBar: true,
    roleRules: DEFAULT_ROLE_RULES,
  };
}

// ---------------------------------------------------------------------------
// Fixtures: temp dirs per describe block
// ---------------------------------------------------------------------------

// Suite A: agent with input_tokens + cache fields
let suiteA_tmpBase: string;
let suiteA_cfg: Cfg;

// Suite B: agent WITHOUT optional fields
let suiteB_tmpBase: string;
let suiteB_cfg: Cfg;

// Suite C: two agents — one with inTok, one without — loop total test
let suiteC_tmpBase: string;
let suiteC_cfg: Cfg;

beforeAll(() => {
  // ---------- Suite A: agent WITH all optional token fields ----------
  suiteA_tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-m2a-'));
  const wfA = path.join(suiteA_tmpBase, 'proj', 'subagents', 'workflows', 'wf_m2a');
  fs.mkdirSync(wfA, { recursive: true });
  writeAgentTranscript(wfA, 'agent1', [
    { type: 'user', message: { content: 'You are the implementer' } },
    {
      type: 'assistant',
      message: {
        usage: {
          output_tokens: 100,
          input_tokens: 400,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 600,
        },
        content: [{ type: 'text', text: 'Fixing things' }],
      },
    },
    {
      type: 'assistant',
      message: {
        usage: {
          output_tokens: 50,
          input_tokens: 150,
          cache_read_input_tokens: 300,
        },
        content: [{ type: 'text', text: 'Done' }],
      },
    },
  ]);
  writeJournal(wfA, 'agent1');
  // Touch the dir so it's the newest wf_*
  const nowA = new Date();
  fs.utimesSync(wfA, nowA, nowA);
  suiteA_cfg = makeCfg(suiteA_tmpBase);

  // ---------- Suite B: agent WITHOUT optional token fields ----------
  suiteB_tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-m2b-'));
  const wfB = path.join(suiteB_tmpBase, 'proj', 'subagents', 'workflows', 'wf_m2b');
  fs.mkdirSync(wfB, { recursive: true });
  writeAgentTranscript(wfB, 'agent1', [
    { type: 'user', message: { content: 'You are the implementer' } },
    {
      type: 'assistant',
      message: {
        usage: { output_tokens: 80 },
        content: [{ type: 'text', text: 'Working' }],
      },
    },
  ]);
  writeJournal(wfB, 'agent1');
  const nowB = new Date();
  fs.utimesSync(wfB, nowB, nowB);
  suiteB_cfg = makeCfg(suiteB_tmpBase);

  // ---------- Suite C: two agents, mixed optional fields ----------
  suiteC_tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-m2c-'));
  const wfC = path.join(suiteC_tmpBase, 'proj', 'subagents', 'workflows', 'wf_m2c');
  fs.mkdirSync(wfC, { recursive: true });
  // Agent 1: has inTok
  writeAgentTranscript(wfC, 'agent1', [
    { type: 'user', message: { content: 'You are the implementer' } },
    {
      type: 'assistant',
      message: {
        usage: { output_tokens: 100, input_tokens: 300 },
        content: [{ type: 'text', text: 'A' }],
      },
    },
  ]);
  // Agent 2: no inTok
  writeAgentTranscript(wfC, 'agent2', [
    { type: 'user', message: { content: 'You are the verifier' } },
    {
      type: 'assistant',
      message: {
        usage: { output_tokens: 60 },
        content: [{ type: 'text', text: 'B' }],
      },
    },
  ]);
  const journalC = [
    JSON.stringify({ type: 'started', agentId: 'agent1' }),
    JSON.stringify({ type: 'result', agentId: 'agent1', result: 'done' }),
    JSON.stringify({ type: 'started', agentId: 'agent2' }),
    JSON.stringify({ type: 'result', agentId: 'agent2', result: 'done' }),
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(wfC, 'journal.jsonl'), journalC, 'utf8');
  const nowC = new Date();
  fs.utimesSync(wfC, nowC, nowC);
  suiteC_cfg = makeCfg(suiteC_tmpBase);
});

afterAll(() => {
  for (const tmpBase of [suiteA_tmpBase, suiteB_tmpBase, suiteC_tmpBase]) {
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  }
});

// ---------------------------------------------------------------------------
// agentStats — optional field contracts (unit level)
// ---------------------------------------------------------------------------
describe('agentStats — M2 optional token field contracts', () => {
  it('collects all three optional fields when all present in every turn', () => {
    const events = [
      {
        type: 'assistant',
        message: {
          usage: {
            output_tokens: 100,
            input_tokens: 400,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 600,
          },
          content: [],
        },
      },
    ];
    const stats = agentStats(events);
    expect(stats.outTok).toBe(100);
    expect(stats.inTok).toBe(400);
    expect(stats.cacheCreate).toBe(200);
    expect(stats.cacheRead).toBe(600);
  });

  it('optional fields are absent (undefined) when usage block has no optional fields', () => {
    const events = [
      { type: 'assistant', message: { usage: { output_tokens: 50 }, content: [] } },
    ];
    const stats = agentStats(events);
    expect(stats.outTok).toBe(50);
    expect(stats.inTok).toBeUndefined();
    expect(stats.cacheCreate).toBeUndefined();
    expect(stats.cacheRead).toBeUndefined();
  });

  it('optional fields are absent when events array is empty', () => {
    const stats = agentStats([]);
    expect(stats.outTok).toBe(0);
    expect(stats.inTok).toBeUndefined();
    expect(stats.cacheCreate).toBeUndefined();
    expect(stats.cacheRead).toBeUndefined();
  });

  it('accumulates inTok across multiple turns — does not double-count turns without it', () => {
    const events = [
      { type: 'assistant', message: { usage: { output_tokens: 10 }, content: [] } },          // no inTok
      { type: 'assistant', message: { usage: { output_tokens: 20, input_tokens: 100 }, content: [] } }, // has inTok
      { type: 'assistant', message: { usage: { output_tokens: 30, input_tokens: 50 }, content: [] } },  // has inTok
    ];
    const stats = agentStats(events);
    expect(stats.outTok).toBe(60);
    expect(stats.inTok).toBe(150); // only sums turns that have the field
  });

  it('result object has no inTok key when field is absent (not just undefined value)', () => {
    const events = [
      { type: 'assistant', message: { usage: { output_tokens: 50 }, content: [] } },
    ];
    const stats = agentStats(events);
    // The key must not exist at all, not just be undefined — prevents JSON serialization of undefined
    expect(Object.prototype.hasOwnProperty.call(stats, 'inTok')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(stats, 'cacheCreate')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(stats, 'cacheRead')).toBe(false);
  });

  it('result object has inTok key when field is present', () => {
    const events = [
      { type: 'assistant', message: { usage: { output_tokens: 50, input_tokens: 200 }, content: [] } },
    ];
    const stats = agentStats(events);
    expect(Object.prototype.hasOwnProperty.call(stats, 'inTok')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildSnapshot — optional field propagation
// ---------------------------------------------------------------------------
describe('buildSnapshot — M2 optional token fields in agents + loop', () => {
  it('Suite A: agent carries inTok/cacheCreate/cacheRead when present in transcript', () => {
    const result = buildSnapshot(suiteA_cfg);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const snap = result as SnapshotOk;
    expect(snap.agents.length).toBe(1);
    const a = snap.agents[0]!;
    // inTok = 400 + 150 = 550
    expect(a.inTok).toBe(550);
    // cacheCreate = 200 (only first turn has it)
    expect(a.cacheCreate).toBe(200);
    // cacheRead = 600 + 300 = 900
    expect(a.cacheRead).toBe(900);
    // outTok = 100 + 50 = 150
    expect(a.tokens).toBe(150);
  });

  it('Suite A: loop totals aggregate inTok/cacheCreate/cacheRead', () => {
    const result = buildSnapshot(suiteA_cfg);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { loop } = result as SnapshotOk;
    expect(loop.inTok).toBe(550);
    expect(loop.cacheCreate).toBe(200);
    expect(loop.cacheRead).toBe(900);
    expect(loop.outTok).toBe(150);
  });

  it('Suite B: agent has no inTok/cacheCreate/cacheRead when absent in transcript', () => {
    const result = buildSnapshot(suiteB_cfg);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const snap = result as SnapshotOk;
    const a = snap.agents[0]!;
    expect(a.inTok).toBeUndefined();
    expect(a.cacheCreate).toBeUndefined();
    expect(a.cacheRead).toBeUndefined();
    expect(a.tokens).toBe(80);
  });

  it('Suite B: loop has no inTok/cacheCreate/cacheRead when no agent has them', () => {
    const result = buildSnapshot(suiteB_cfg);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { loop } = result as SnapshotOk;
    expect(loop.inTok).toBeUndefined();
    expect(loop.cacheCreate).toBeUndefined();
    expect(loop.cacheRead).toBeUndefined();
    expect(loop.outTok).toBe(80);
  });

  it('Suite C: loop.inTok aggregates across agents — counts only agents that have it', () => {
    const result = buildSnapshot(suiteC_cfg);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const snap = result as SnapshotOk;
    // Agent1 has inTok=300, agent2 has none.
    // Loop should be defined (at least one agent has it) and equal to 300.
    expect(snap.loop.inTok).toBe(300);
    // outTok should sum both agents: 100 + 60 = 160
    expect(snap.loop.outTok).toBe(160);
  });

  it('Suite C: agent without inTok has undefined inTok (not 0)', () => {
    const result = buildSnapshot(suiteC_cfg);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const snap = result as SnapshotOk;
    // Identify agent2 by lower output token count (outTok=60); agent2 has no inTok field.
    const lowTokAgent = snap.agents.find((a) => a.tokens === 60);
    expect(lowTokAgent).toBeDefined();
    if (!lowTokAgent) return;
    expect(lowTokAgent.inTok).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getHtml — rendering logic for optional token fields
// ---------------------------------------------------------------------------
describe('getHtml — M2 metrics rendering', () => {
  const html = getHtml(TEST_NONCE);

  it('overview() renders "Out tokens" label for output token KPI', () => {
    expect(html).toContain('Out tokens');
  });

  it('overview() includes a data-testid for the out-tokens KPI', () => {
    expect(html).toContain('data-testid="loop-out-tok"');
  });

  it('overview() includes a data-testid for the tool-calls KPI', () => {
    expect(html).toContain('data-testid="loop-tools"');
  });

  it('overview() JS guards optional inTok KPI with != null check (no NaN when absent)', () => {
    // The guard must be L.inTok!=null — this prevents rendering when undefined or null
    expect(html).toContain('L.inTok!=null');
  });

  it('overview() JS guards optional cacheRead KPI with != null check', () => {
    expect(html).toContain('L.cacheRead!=null');
  });

  it('overview() JS guards optional cacheCreate KPI with != null check', () => {
    expect(html).toContain('L.cacheCreate!=null');
  });

  it('overview() renders "In tokens" label for inTok KPI', () => {
    expect(html).toContain('In tokens');
  });

  it('overview() renders "Cache read" label for cacheRead KPI', () => {
    expect(html).toContain('Cache read');
  });

  it('overview() renders "Cache write" label for cacheCreate KPI', () => {
    expect(html).toContain('Cache write');
  });

  it('agentsPanel() JS guards agent inTok with != null check', () => {
    expect(html).toContain('a.inTok!=null');
  });

  it('agentsPanel() JS guards agent cacheRead with != null check', () => {
    expect(html).toContain('a.cacheRead!=null');
  });

  it('agentsPanel() JS guards agent cacheCreate with != null check', () => {
    expect(html).toContain('a.cacheCreate!=null');
  });

  it('agentsPanel() uses fmtTok() for output token display', () => {
    // fmtTok must be defined in the webview JS
    expect(html).toContain('function fmtTok(n)');
  });

  // fmtTok calls safeN internally — both must be extracted together for eval.
  function extractFmtTok(h: string): (n: unknown) => string {
    const lines = h.split('\n');
    // safeN is on a line containing 'function safeN(n)'
    const safeNLine = lines.find((l) => l.includes('function safeN(n)'));
    if (!safeNLine) throw new Error('safeN not found in getHtml output');
    const safeNStart = safeNLine.indexOf('function safeN(n)');
    const safeNSnippet = safeNLine.slice(safeNStart);
    // fmtTok is on a line containing 'function fmtTok(n)'
    const fmtLine = lines.find((l) => l.includes('function fmtTok(n)'));
    if (!fmtLine) throw new Error('fmtTok not found in getHtml output');
    const fmtStart = fmtLine.indexOf('function fmtTok(n)');
    const fmtSnippet = fmtLine.slice(fmtStart);
    return new Function(`${safeNSnippet}\n${fmtSnippet}\nreturn fmtTok;`)() as (n: unknown) => string;
  }

  it('fmtTok formats values under 1k as integer', () => {
    const fn = extractFmtTok(html);
    expect(fn(500)).toBe('500');
    expect(fn(0)).toBe('0');
    expect(fn(999)).toBe('999');
  });

  it('fmtTok formats values 1k–999k with one decimal and k suffix', () => {
    const fn = extractFmtTok(html);
    expect(fn(1000)).toBe('1.0k');
    expect(fn(1500)).toBe('1.5k');
    expect(fn(10000)).toBe('10.0k');
    expect(fn(999999)).toContain('k');
  });

  it('fmtTok formats values >= 1M with two decimals and M suffix', () => {
    const fn = extractFmtTok(html);
    expect(fn(1_000_000)).toBe('1.00M');
    expect(fn(2_500_000)).toBe('2.50M');
  });

  it('fmtTok uses safeN to guard against NaN — returns "0" for non-numeric input', () => {
    const lines = html.split('\n');
    // fmtTok must be on the same line as safeN (it calls safeN internally)
    const line = lines.find((l) => l.includes('function fmtTok(n)'));
    if (!line) throw new Error('fmtTok not found in getHtml output');
    const start = line.indexOf('function fmtTok(n)');
    const snippet = line.slice(start);
    // safeN must be defined before fmtTok — extract it too
    const safeNLine = lines.find((l) => l.includes('function safeN(n)'));
    if (!safeNLine) throw new Error('safeN not found');
    const safeNStart = safeNLine.indexOf('function safeN(n)');
    const safeNSnippet = safeNLine.slice(safeNStart);
    const fn = new Function(`${safeNSnippet}\n${snippet}\nreturn fmtTok;`)() as (n: unknown) => string;
    // NaN input → safeN returns 0 → fmtTok returns '0'
    expect(fn(NaN)).toBe('0');
    expect(fn(undefined)).toBe('0');
    expect(fn(null)).toBe('0');
  });

  it('agentsPanel uses .agent-metrics class for the metrics bar', () => {
    expect(html).toContain("class=\"agent-metrics\"");
  });

  it('CSS contains .agent-metrics rule (theme-native, no hardcoded colors)', () => {
    expect(html).toContain('.agent-metrics{');
  });

  it('CSS .agent-metric uses font-variant-numeric:tabular-nums for alignment', () => {
    expect(html).toContain('font-variant-numeric:tabular-nums');
  });

  it('inline script is still syntactically valid JS after M2 additions', () => {
    const scriptOpen = `<script nonce="${TEST_NONCE}">`;
    const scriptClose = '</script>';
    const scriptStart = html.indexOf(scriptOpen);
    const scriptEnd = html.lastIndexOf(scriptClose);
    const scriptContent = html.slice(scriptStart + scriptOpen.length, scriptEnd);
    expect(() => {
      new Function('acquireVsCodeApi', 'document', 'window', 'CSS', scriptContent);
    }).not.toThrow();
  });
});
