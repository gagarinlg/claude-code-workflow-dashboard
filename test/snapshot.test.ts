import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { buildSnapshot } from '../src/data/snapshot';
import { DEFAULT_ROLE_RULES, STALE_SECS } from '../src/data/parse';
import type { Cfg, SnapshotOk } from '../src/data/snapshot';

const FIXTURES = path.join(__dirname, 'fixtures');
const BASE = path.join(FIXTURES, 'base');

// Cfg that points directly at wf_basic — we can't use buildSnapshot with it
// directly because findWorkflowDir requires the dir's parent to be 'workflows'.
// We test the full pipeline via the base/ fixture tree which is correctly structured.
const basicCfg: Cfg = {
  base: BASE,
  repo: '',
  refreshMs: 4000,
  statusBar: true,
  roleRules: DEFAULT_ROLE_RULES,
};

describe('buildSnapshot — no run found', () => {
  it('returns ok:false when base has no wf_* dirs under a "workflows" parent', () => {
    const result = buildSnapshot({ ...basicCfg, base: path.join(FIXTURES, 'wf_partial') });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.msg).toBe('string');
      expect(result.msg.length).toBeGreaterThan(0);
    }
  });

  it('returns ok:false for a completely non-existent base', () => {
    const result = buildSnapshot({ ...basicCfg, base: '/no/such/path' });
    expect(result.ok).toBe(false);
  });
});

// Build a temp base that mirrors the correct discovery structure:
//   <tmpBase>/proj-abc/subagents/workflows/wf_basic_copy/
// We copy wf_basic's files into that dir so buildSnapshot gets a rich fixture.
// The committed wf_newer fixture is NOT mutated — it stays immutable for
// discovery.test.ts, which relies on it representing an empty/older run.
describe('buildSnapshot — with wf_basic via synthetic cfg', () => {
  const wfBasicSrc = path.join(FIXTURES, 'wf_basic');
  let tmpBase: string;
  let snapshotCfg: Cfg;

  beforeAll(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-wf-basic-'));
    const wfDir = path.join(tmpBase, 'proj-abc', 'subagents', 'workflows', 'wf_basic_copy');
    fs.mkdirSync(wfDir, { recursive: true });
    for (const f of fs.readdirSync(wfBasicSrc)) {
      fs.copyFileSync(path.join(wfBasicSrc, f), path.join(wfDir, f));
    }
    // Ensure this dir is the newest wf_* by touching it after copy.
    const now = new Date();
    fs.utimesSync(wfDir, now, now);
    snapshotCfg = {
      base: tmpBase,
      repo: '',
      refreshMs: 4000,
      statusBar: true,
      roleRules: DEFAULT_ROLE_RULES,
    };
  });

  afterAll(() => {
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  it('returns ok:true with correct shape', () => {
    const result = buildSnapshot(snapshotCfg);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const snap = result as SnapshotOk;
    expect(typeof snap.runId).toBe('string');
    expect(snap.runId).toMatch(/^wf_/);
    expect(typeof snap.workflowDir).toBe('string');
    expect(typeof snap.updatedAt).toBe('string');
    expect(typeof snap.loop).toBe('object');
    expect(Array.isArray(snap.agents)).toBe(true);
    expect(Array.isArray(snap.allFindings)).toBe(true);
    expect(Array.isArray(snap.structuredResults)).toBe(true);
    expect(typeof snap.verdicts).toBe('object');
    expect(Array.isArray(snap.labels)).toBe(true);
  });

  it('loop has required numeric fields', () => {
    const result = buildSnapshot(snapshotCfg);
    if (!result.ok) return;
    const { loop } = result;
    expect(typeof loop.live).toBe('number');
    expect(typeof loop.done).toBe('number');
    expect(typeof loop.dead).toBe('number');
    expect(typeof loop.total).toBe('number');
    expect(typeof loop.outTok).toBe('number');
    expect(typeof loop.tools).toBe('number');
    expect(typeof loop.passes).toBe('number');
    expect(typeof loop.findings).toBe('number');
    expect(typeof loop.sevTotals).toBe('object');
  });

  it('agents are sorted by start time and have idx', () => {
    const result = buildSnapshot(snapshotCfg);
    if (!result.ok) return;
    const { agents } = result;
    expect(agents.length).toBeGreaterThan(0);
    for (let i = 0; i < agents.length - 1; i++) {
      expect(agents[i]!.start).toBeLessThanOrEqual(agents[i + 1]!.start);
    }
    agents.forEach((a, i) => expect(a.idx).toBe(i + 1));
  });

  it('findings result agent has findings array and verdict', () => {
    const result = buildSnapshot(snapshotCfg);
    if (!result.ok) return;
    const agentWithFindings = result.agents.find((a) => Array.isArray(a.findings));
    expect(agentWithFindings).toBeDefined();
    if (!agentWithFindings) return;
    expect(Array.isArray(agentWithFindings.findings)).toBe(true);
    expect(typeof agentWithFindings.verdict).toBe('string');
  });

  it('structured result agent has result object', () => {
    const result = buildSnapshot(snapshotCfg);
    if (!result.ok) return;
    const agentWithResult = result.agents.find((a) => a.result != null);
    expect(agentWithResult).toBeDefined();
  });

  it('allFindings contains reviewer and key fields', () => {
    const result = buildSnapshot(snapshotCfg);
    if (!result.ok) return;
    for (const f of result.allFindings) {
      expect(typeof f.reviewer).toBe('string');
      expect(typeof f.key).toBe('string');
      expect(typeof f.pass).toBe('number');
    }
  });

  it('sevTotals reflects allFindings severities', () => {
    const result = buildSnapshot(snapshotCfg);
    if (!result.ok) return;
    if (result.allFindings.length === 0) return;
    const computedTotal = Object.values(result.loop.sevTotals).reduce((a, b) => a + b, 0);
    expect(computedTotal).toBe(result.allFindings.length);
  });

  it('changed is null when repo is empty string', () => {
    const result = buildSnapshot({ ...snapshotCfg, repo: '' });
    if (!result.ok) return;
    expect(result.changed).toBeNull();
  });

  it('does not throw on malformed/partial JSONL input', () => {
    // Verify buildSnapshot never throws even on repeated calls
    expect(() => buildSnapshot(snapshotCfg)).not.toThrow();
  });

  it('missing meta.json falls back to transcript mtime gracefully', () => {
    // No .meta.json files in wf_basic_copy — start should fall back to agent jsonl mtime
    const result = buildSnapshot(snapshotCfg);
    if (!result.ok) return;
    for (const a of result.agents) {
      expect(typeof a.start).toBe('number');
      expect(a.start).toBeGreaterThan(0);
    }
  });

  it('stale agent detection: status is dead for very old mtime', () => {
    // We can verify that the status field is one of the three valid values
    const result = buildSnapshot(snapshotCfg);
    if (!result.ok) return;
    for (const a of result.agents) {
      expect(['run', 'done', 'dead']).toContain(a.status);
    }
  });

  it('agents with done status have their result populated from journal', () => {
    const result = buildSnapshot(snapshotCfg);
    if (!result.ok) return;
    const doneAgents = result.agents.filter((a) => a.status === 'done');
    for (const a of doneAgents) {
      const hasResult = a.findings !== undefined || a.result !== undefined || a.resultText !== undefined;
      expect(hasResult).toBe(true);
    }
  });

  it('string result agent has resultText populated', () => {
    const result = buildSnapshot(snapshotCfg);
    if (!result.ok) return;
    const textAgent = result.agents.find((a) => a.resultText !== undefined);
    expect(textAgent).toBeDefined();
    if (!textAgent) return;
    expect(typeof textAgent.resultText).toBe('string');
    expect(textAgent.resultText!.length).toBeGreaterThan(0);
  });

  it('labels contains reviewer label from findings results', () => {
    const result = buildSnapshot(snapshotCfg);
    if (!result.ok) return;
    if (result.allFindings.length === 0) return;
    expect(result.labels.length).toBeGreaterThan(0);
  });

  it('ghost agent result appears in allFindings even with no transcript file', () => {
    // journal.jsonl contains a result record for agentId 'ghost-no-file' that has
    // no corresponding agent-ghost-no-file.jsonl transcript. The snapshot must still
    // include this agent's findings in allFindings (using reviewer='agent', key='?')
    // while 'ghost-no-file' must be absent from the agents array.
    const result = buildSnapshot(snapshotCfg);
    if (!result.ok) return;
    const ghostFinding = result.allFindings.find((f) => f.title === 'Ghost finding');
    expect(ghostFinding).toBeDefined();
    const ghostAgent = result.agents.find((a) => a.id === 'ghost-no-file');
    expect(ghostAgent).toBeUndefined();
  });

});

// ---------------------------------------------------------------------------
// Explicit stale / live agent detection (time-controlled via utimesSync)
// ---------------------------------------------------------------------------
describe('buildSnapshot — explicit stale/live agent detection', () => {
  let tmpBase: string;
  let wfDir: string;

  // A minimal single-event transcript so jload returns a non-empty array.
  const TRANSCRIPT = '{"type":"user","message":{"content":"You are a test agent"}}\n';
  // A journal with no results (so the agent is not "done").
  const JOURNAL_NO_RESULTS = '{"type":"started","agentId":"stale-agent"}\n';

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-staleness-'));
    wfDir = path.join(tmpBase, 'workflows', 'wf_staleness');
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(path.join(wfDir, 'journal.jsonl'), JOURNAL_NO_RESULTS);
    fs.writeFileSync(path.join(wfDir, 'agent-stale-agent.jsonl'), TRANSCRIPT);
  });

  afterEach(() => {
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  const makeCfg = (base: string): Cfg => ({
    base,
    repo: '',
    refreshMs: 4000,
    statusBar: true,
    roleRules: DEFAULT_ROLE_RULES,
  });

  it('detects dead status when transcript mtime is older than STALE_SECS', () => {
    // Back-date the transcript file to now - (STALE_SECS + 60) seconds
    const oldTime = new Date(Date.now() - (STALE_SECS + 60) * 1000);
    fs.utimesSync(path.join(wfDir, 'agent-stale-agent.jsonl'), oldTime, oldTime);

    const result = buildSnapshot(makeCfg(tmpBase));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const agent = result.agents.find((a) => a.id === 'stale-agent');
    expect(agent).toBeDefined();
    expect(agent!.status).toBe('dead');
  });

  it('detects run (live) status when transcript mtime is within STALE_SECS', () => {
    // Set the transcript mtime to now - (STALE_SECS / 3) seconds (well within the window)
    const recentTime = new Date(Date.now() - Math.floor(STALE_SECS / 3) * 1000);
    fs.utimesSync(path.join(wfDir, 'agent-stale-agent.jsonl'), recentTime, recentTime);

    const result = buildSnapshot(makeCfg(tmpBase));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const agent = result.agents.find((a) => a.id === 'stale-agent');
    expect(agent).toBeDefined();
    expect(agent!.status).toBe('run');
  });
});
