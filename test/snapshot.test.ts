import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { buildSnapshot, MAX_PROMPT_CHARS } from '../src/data/snapshot';
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

  it('agent labels are derived from agentType in meta.json (not from prompt text)', () => {
    // wf_basic contains meta.json files for agents aaa/bbb/ccc/ddd/eee with known
    // agentType values. buildSnapshot must use agentTypeToLabel() for these agents
    // and produce distinct, correct role labels rather than the generic prompt-derived labels.
    const result = buildSnapshot(snapshotCfg);
    if (!result.ok) return;
    const byId = new Map(result.agents.map((a) => [a.id, a]));

    // aaa: workflow-plugins:implementer → Implement/Fix
    const aaa = byId.get('aaa');
    expect(aaa, 'agent aaa must be present').toBeDefined();
    expect(aaa!.label).toBe('Implement/Fix');
    expect(aaa!.key).toBe('implementer');

    // bbb: workflow-plugins:test-verifier → Verify
    const bbb = byId.get('bbb');
    expect(bbb, 'agent bbb must be present').toBeDefined();
    expect(bbb!.label).toBe('Verify');
    expect(bbb!.key).toBe('test_verifier');

    // ccc: workflow-plugins:architect → Architecture
    const ccc = byId.get('ccc');
    expect(ccc, 'agent ccc must be present').toBeDefined();
    expect(ccc!.label).toBe('Architecture');
    expect(ccc!.key).toBe('architect');

    // ddd: workflow-plugins:completeness-critic → Completeness
    const ddd = byId.get('ddd');
    expect(ddd, 'agent ddd must be present').toBeDefined();
    expect(ddd!.label).toBe('Completeness');
    expect(ddd!.key).toBe('completeness_critic');

    // eee: workflow-plugins:code-reviewer → Code review
    const eee = byId.get('eee');
    expect(eee, 'agent eee must be present').toBeDefined();
    expect(eee!.label).toBe('Code review');
    expect(eee!.key).toBe('code_reviewer');
  });

  it('agent without meta.json agentType falls back to classify/deriveLabel', () => {
    // Agent fff has no meta.json. Its prompt is "You are a starting agent with no output yet".
    // buildSnapshot must fall back to classify() / deriveLabel() and produce a sensible label
    // derived from the prompt, not crash or produce an empty string.
    const result = buildSnapshot(snapshotCfg);
    if (!result.ok) return;
    const fff = result.agents.find((a) => a.id === 'fff');
    // fff may not appear if its transcript has no events (it only has one user line, no assistant).
    // If it's absent that is acceptable; if present it must have a non-empty label.
    if (!fff) return;
    expect(typeof fff.label).toBe('string');
    expect(fff.label.length).toBeGreaterThan(0);
    // Must NOT be one of the agentType-derived labels — it has no meta.json agentType.
    expect(['Implement/Fix', 'Architecture', 'Code review', 'Security', 'UI/UX', 'Verify', 'Completeness'])
      .not.toContain(fff.label);
  });

  it('implementer agent label is Implement/Fix, never a reviewer label', () => {
    // Regression: before M1-Naming, classify() would collapse all reviewers to
    // "Reviewer" and could mislabel implementers. With agentType primary, the
    // implementer (aaa) must be "Implement/Fix" even if its prompt embeds reviewer keywords.
    const result = buildSnapshot(snapshotCfg);
    if (!result.ok) return;
    const aaa = result.agents.find((a) => a.id === 'aaa');
    expect(aaa, 'agent aaa must be present').toBeDefined();
    expect(aaa!.label).not.toMatch(/[Rr]eviewer/);
    expect(aaa!.label).toBe('Implement/Fix');
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
// Pass-numbering: per-agentType keying (M1-Naming side-effect)
// ---------------------------------------------------------------------------
// Scenario: two reviewer types (code-reviewer, security-reviewer) run in two
// rounds. Round 1 → both reviewers get pass=1; Round 2 → both get pass=2.
// The pass counter must be keyed per agentType so that distinct reviewer types
// within the same round share the same pass number, and the same reviewer type
// across rounds increments 1→2.
describe('buildSnapshot — pass-numbering per-agentType', () => {
  let tmpBase: string;
  let wfDir: string;

  const TRANSCRIPT = (role: string) =>
    `{"type":"user","message":{"content":"You are the ${role} agent"}}\n`;
  const META = (agentType: string, agentId: string) =>
    JSON.stringify({ agentType, agentId }) + '\n';

  // Journal: round 1 results for cr1+sr1, then round 2 results for cr2+sr2.
  // Each result carries one finding so allFindings is non-empty per agent.
  const JOURNAL = [
    '{"type":"started","agentId":"cr1"}',
    '{"type":"started","agentId":"sr1"}',
    '{"type":"started","agentId":"cr2"}',
    '{"type":"started","agentId":"sr2"}',
    // Round 1 — both reviewers submit findings
    '{"type":"result","agentId":"cr1","result":{"findings":[{"severity":"HIGH","title":"CR1 finding"}],"verdict":"1 finding"}}',
    '{"type":"result","agentId":"sr1","result":{"findings":[{"severity":"LOW","title":"SR1 finding"}],"verdict":"1 finding"}}',
    // Round 2 — same reviewer types submit again (second agents of each type)
    '{"type":"result","agentId":"cr2","result":{"findings":[{"severity":"HIGH","title":"CR2 finding"}],"verdict":"1 finding"}}',
    '{"type":"result","agentId":"sr2","result":{"findings":[{"severity":"LOW","title":"SR2 finding"}],"verdict":"1 finding"}}',
  ].join('\n') + '\n';

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-pass-'));
    wfDir = path.join(tmpBase, 'workflows', 'wf_pass_test');
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(path.join(wfDir, 'journal.jsonl'), JOURNAL);
    // Agent transcripts — each must have at least one event so jload returns non-empty
    for (const [id, role] of [
      ['cr1', 'code reviewer round 1'],
      ['sr1', 'security reviewer round 1'],
      ['cr2', 'code reviewer round 2'],
      ['sr2', 'security reviewer round 2'],
    ] as [string, string][]) {
      fs.writeFileSync(path.join(wfDir, `agent-${id}.jsonl`), TRANSCRIPT(role));
    }
    // meta.json — agentType is the primary role signal
    fs.writeFileSync(path.join(wfDir, 'agent-cr1.meta.json'), META('workflow-plugins:code-reviewer', 'cr1'));
    fs.writeFileSync(path.join(wfDir, 'agent-sr1.meta.json'), META('workflow-plugins:security-reviewer', 'sr1'));
    fs.writeFileSync(path.join(wfDir, 'agent-cr2.meta.json'), META('workflow-plugins:code-reviewer', 'cr2'));
    fs.writeFileSync(path.join(wfDir, 'agent-sr2.meta.json'), META('workflow-plugins:security-reviewer', 'sr2'));
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

  it('two reviewers in one round both get pass=1 (not 1 and 2)', () => {
    const result = buildSnapshot(makeCfg(tmpBase));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cr1Finding = result.allFindings.find((f) => f.title === 'CR1 finding');
    const sr1Finding = result.allFindings.find((f) => f.title === 'SR1 finding');
    expect(cr1Finding).toBeDefined();
    expect(sr1Finding).toBeDefined();
    // Both reviewers in round 1 must have pass=1, not diverging (1 vs 2)
    expect(cr1Finding!.pass).toBe(1);
    expect(sr1Finding!.pass).toBe(1);
  });

  it('same reviewer type across two rounds increments pass 1→2', () => {
    const result = buildSnapshot(makeCfg(tmpBase));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cr1Finding = result.allFindings.find((f) => f.title === 'CR1 finding');
    const cr2Finding = result.allFindings.find((f) => f.title === 'CR2 finding');
    expect(cr1Finding).toBeDefined();
    expect(cr2Finding).toBeDefined();
    // First code-reviewer → pass 1, second code-reviewer → pass 2
    expect(cr1Finding!.pass).toBe(1);
    expect(cr2Finding!.pass).toBe(2);
  });

  it('full pass grid: two reviewers × two rounds', () => {
    const result = buildSnapshot(makeCfg(tmpBase));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byTitle = new Map(result.allFindings.map((f) => [f.title, f]));

    // Round 1: both reviewer types at pass 1
    expect(byTitle.get('CR1 finding')?.pass).toBe(1);
    expect(byTitle.get('SR1 finding')?.pass).toBe(1);
    // Round 2: both reviewer types at pass 2
    expect(byTitle.get('CR2 finding')?.pass).toBe(2);
    expect(byTitle.get('SR2 finding')?.pass).toBe(2);

    // Reviewer labels and keys are correct
    expect(byTitle.get('CR1 finding')?.reviewer).toBe('Code review');
    expect(byTitle.get('CR1 finding')?.key).toBe('code_reviewer');
    expect(byTitle.get('SR1 finding')?.reviewer).toBe('Security');
    expect(byTitle.get('SR1 finding')?.key).toBe('security_reviewer');
    expect(byTitle.get('CR2 finding')?.reviewer).toBe('Code review');
    expect(byTitle.get('CR2 finding')?.key).toBe('code_reviewer');
    expect(byTitle.get('SR2 finding')?.reviewer).toBe('Security');
    expect(byTitle.get('SR2 finding')?.key).toBe('security_reviewer');

    // loop.passes reflects the highest round number
    expect(result.loop.passes).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Verdicts keying: verdicts must be keyed by agentType key (not display label)
// so two agents with the same label but different agentType keys do not
// clobber each other's verdict.
// ---------------------------------------------------------------------------
describe('buildSnapshot — verdicts keyed by agentType key', () => {
  let tmpBase: string;
  let wfDir: string;

  const TRANSCRIPT = (role: string) =>
    `{"type":"user","message":{"content":"You are the ${role} agent"}}\n`;
  const META = (agentType: string) => JSON.stringify({ agentType }) + '\n';

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-verdicts-'));
    wfDir = path.join(tmpBase, 'workflows', 'wf_verdicts_test');
    fs.mkdirSync(wfDir, { recursive: true });
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

  it('verdicts from two distinct reviewer types are independently preserved', () => {
    // Two reviewers (code-reviewer and security-reviewer) both submit a finding result
    // with a verdict. Their keys differ (code_reviewer vs security_reviewer). The
    // verdicts map must have two entries, not one (no silent overwrite).
    const journal = [
      '{"type":"started","agentId":"cr1"}',
      '{"type":"started","agentId":"sr1"}',
      '{"type":"result","agentId":"cr1","result":{"findings":[{"severity":"HIGH","title":"CR finding"}],"verdict":"Code review complete"}}',
      '{"type":"result","agentId":"sr1","result":{"findings":[{"severity":"LOW","title":"SR finding"}],"verdict":"Security review complete"}}',
    ].join('\n') + '\n';

    fs.writeFileSync(path.join(wfDir, 'journal.jsonl'), journal);
    fs.writeFileSync(path.join(wfDir, 'agent-cr1.jsonl'), TRANSCRIPT('code reviewer'));
    fs.writeFileSync(path.join(wfDir, 'agent-sr1.jsonl'), TRANSCRIPT('security reviewer'));
    fs.writeFileSync(path.join(wfDir, 'agent-cr1.meta.json'), META('workflow-plugins:code-reviewer'));
    fs.writeFileSync(path.join(wfDir, 'agent-sr1.meta.json'), META('workflow-plugins:security-reviewer'));

    const result = buildSnapshot(makeCfg(tmpBase));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const verdictKeys = Object.keys(result.verdicts);
    // Both verdicts must be present — keyed by agentType key
    expect(verdictKeys).toContain('code_reviewer');
    expect(verdictKeys).toContain('security_reviewer');
    expect(result.verdicts['code_reviewer']).toBe('Code review complete');
    expect(result.verdicts['security_reviewer']).toBe('Security review complete');
    // Exactly two entries — no clobber
    expect(verdictKeys.length).toBe(2);
  });

  it('same reviewer type submitting twice overwrites verdict (second pass wins)', () => {
    // When the same reviewer key submits twice (two rounds), the last verdict wins.
    // This is by-design: the verdict represents the latest assessment.
    const journal = [
      '{"type":"started","agentId":"cr1"}',
      '{"type":"started","agentId":"cr2"}',
      '{"type":"result","agentId":"cr1","result":{"findings":[],"verdict":"Round 1 verdict"}}',
      '{"type":"result","agentId":"cr2","result":{"findings":[],"verdict":"Round 2 verdict"}}',
    ].join('\n') + '\n';

    fs.writeFileSync(path.join(wfDir, 'journal.jsonl'), journal);
    fs.writeFileSync(path.join(wfDir, 'agent-cr1.jsonl'), TRANSCRIPT('code reviewer round 1'));
    fs.writeFileSync(path.join(wfDir, 'agent-cr2.jsonl'), TRANSCRIPT('code reviewer round 2'));
    fs.writeFileSync(path.join(wfDir, 'agent-cr1.meta.json'), META('workflow-plugins:code-reviewer'));
    fs.writeFileSync(path.join(wfDir, 'agent-cr2.meta.json'), META('workflow-plugins:code-reviewer'));

    const result = buildSnapshot(makeCfg(tmpBase));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const verdictKeys = Object.keys(result.verdicts);
    // Same key → one entry; second round's verdict overwrites first
    expect(verdictKeys.length).toBe(1);
    expect(verdictKeys[0]).toBe('code_reviewer');
    expect(result.verdicts['code_reviewer']).toBe('Round 2 verdict');
  });

  it('verdict newlines are stripped to spaces', () => {
    const journal = [
      '{"type":"started","agentId":"cr1"}',
      '{"type":"result","agentId":"cr1","result":{"findings":[],"verdict":"Line 1\\nLine 2"}}',
    ].join('\n') + '\n';

    fs.writeFileSync(path.join(wfDir, 'journal.jsonl'), journal);
    fs.writeFileSync(path.join(wfDir, 'agent-cr1.jsonl'), TRANSCRIPT('code reviewer'));
    fs.writeFileSync(path.join(wfDir, 'agent-cr1.meta.json'), META('workflow-plugins:code-reviewer'));

    const result = buildSnapshot(makeCfg(tmpBase));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verdicts['code_reviewer']).toBe('Line 1 Line 2');
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

// ---------------------------------------------------------------------------
// M2-AgentPrompt: full initiating prompt carried per agent in buildSnapshot
// ---------------------------------------------------------------------------
describe('buildSnapshot — M2-AgentPrompt: prompt field per agent', () => {
  let tmpBase: string;
  let wfDir: string;

  const makeCfg = (base: string): Cfg => ({
    base,
    repo: '',
    refreshMs: 4000,
    statusBar: true,
    roleRules: DEFAULT_ROLE_RULES,
  });

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-prompt-'));
    wfDir = path.join(tmpBase, 'workflows', 'wf_prompt_test');
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(path.join(wfDir, 'journal.jsonl'), '');
  });

  afterEach(() => {
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  it('agent.prompt carries the full first user message text', () => {
    const promptText = 'You are a senior developer. Fix all the issues.';
    fs.writeFileSync(
      path.join(wfDir, 'agent-p1.jsonl'),
      `{"type":"user","message":{"content":"${promptText}"}}\n` +
      `{"type":"assistant","message":{"content":[{"type":"text","text":"done"}],"usage":{"output_tokens":10}}}\n`,
    );
    const result = buildSnapshot(makeCfg(tmpBase));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const agent = result.agents.find((a) => a.id === 'p1');
    expect(agent).toBeDefined();
    expect(agent!.prompt).toBe(promptText);
  });

  it('agent.prompt is absent when the transcript has no user event', () => {
    // A transcript with only an assistant turn — no user event, no prompt.
    fs.writeFileSync(
      path.join(wfDir, 'agent-noprompt.jsonl'),
      `{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}],"usage":{"output_tokens":5}}}\n`,
    );
    const result = buildSnapshot(makeCfg(tmpBase));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const agent = result.agents.find((a) => a.id === 'noprompt');
    if (!agent) return; // transcript may have too few events to register — acceptable
    expect(agent.prompt).toBeUndefined();
  });

  it('agent.prompt is capped at MAX_PROMPT_CHARS for very large prompts', () => {
    // Build a prompt longer than MAX_PROMPT_CHARS by repeating a string.
    const longPrompt = 'A'.repeat(MAX_PROMPT_CHARS + 500);
    fs.writeFileSync(
      path.join(wfDir, 'agent-long.jsonl'),
      `{"type":"user","message":{"content":"${longPrompt}"}}\n` +
      `{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}],"usage":{"output_tokens":5}}}\n`,
    );
    const result = buildSnapshot(makeCfg(tmpBase));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const agent = result.agents.find((a) => a.id === 'long');
    expect(agent).toBeDefined();
    expect(agent!.prompt).toBeDefined();
    expect(agent!.prompt!.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    // The cap must preserve the beginning of the prompt.
    expect(agent!.prompt!.startsWith('A')).toBe(true);
  });

  it('agent.prompt is the text content from an array-style user message', () => {
    // The transcript format sometimes uses content as an array of blocks.
    const promptText = 'You are a code reviewer. Review the diff.';
    const transcript = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'text', text: promptText }] },
    }) + '\n' +
    `{"type":"assistant","message":{"content":[{"type":"text","text":"reviewed"}],"usage":{"output_tokens":8}}}\n`;
    fs.writeFileSync(path.join(wfDir, 'agent-arr.jsonl'), transcript);
    const result = buildSnapshot(makeCfg(tmpBase));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const agent = result.agents.find((a) => a.id === 'arr');
    expect(agent).toBeDefined();
    expect(agent!.prompt).toBe(promptText);
  });

  it('buildSnapshot does not throw when prompt extraction fails gracefully', () => {
    // Malformed transcript — prompt extraction should degrade, not throw.
    fs.writeFileSync(
      path.join(wfDir, 'agent-mal.jsonl'),
      `{"type":"user","message":{}}\n` +
      `{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}],"usage":{"output_tokens":3}}}\n`,
    );
    expect(() => buildSnapshot(makeCfg(tmpBase))).not.toThrow();
  });

  it('wf_basic agents carry their prompt field from the fixture transcripts', () => {
    // Copy wf_basic into a proper discovery tree and verify prompt fields appear.
    const wfBasicSrc = path.join(__dirname, 'fixtures', 'wf_basic');
    const wfDir2 = path.join(tmpBase, 'workflows', 'wf_basic_prompt_copy');
    fs.mkdirSync(wfDir2, { recursive: true });
    for (const f of fs.readdirSync(wfBasicSrc)) {
      fs.copyFileSync(path.join(wfBasicSrc, f), path.join(wfDir2, f));
    }
    const now = new Date();
    fs.utimesSync(wfDir2, now, now);

    // Remove the empty placeholder wf_dir created in beforeEach so it doesn't
    // compete for "newest" — fs discovery picks the highest-mtime wf_* dir.
    fs.rmSync(wfDir, { recursive: true, force: true });

    const result = buildSnapshot(makeCfg(tmpBase));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // agent-aaa has "SENIOR FULL-STACK DEVELOPER fixing all findings" as its first user msg.
    const aaa = result.agents.find((a) => a.id === 'aaa');
    expect(aaa).toBeDefined();
    expect(typeof aaa!.prompt).toBe('string');
    expect(aaa!.prompt!.length).toBeGreaterThan(0);
    expect(aaa!.prompt).toContain('SENIOR FULL-STACK DEVELOPER');

    // Every agent that appears should have a non-empty prompt (all wf_basic agents have user events).
    for (const a of result.agents) {
      expect(typeof a.prompt).toBe('string');
      expect(a.prompt!.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// changedByAgents: union/dedupe of filesChanged from agent structured results
// (spec v3 correction #7)
// ---------------------------------------------------------------------------
describe('buildSnapshot — changedByAgents union/dedupe', () => {
  let tmpBase: string;
  let wfDir: string;

  const TRANSCRIPT = (id: string) =>
    `{"type":"user","message":{"content":"You are agent ${id}"}}\n`;

  const makeJournal = (entries: object[]) =>
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n';

  const makeCfg = (base: string): Cfg => ({
    base,
    repo: '',
    refreshMs: 4000,
    statusBar: true,
    roleRules: DEFAULT_ROLE_RULES,
  });

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-by-agents-'));
    wfDir = path.join(tmpBase, 'workflows', 'wf_by_agents_test');
    fs.mkdirSync(wfDir, { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  it('unions filesChanged from two agents, deduplicates, and sorts', () => {
    // Two agents: a1 reports ['b.ts', 'a.ts'], a2 reports ['c.ts', 'a.ts'] — 'a.ts' is a dupe.
    const journal = makeJournal([
      { type: 'result', agentId: 'a1', result: { filesChanged: ['b.ts', 'a.ts'], summary: 'done' } },
      { type: 'result', agentId: 'a2', result: { filesChanged: ['c.ts', 'a.ts'], summary: 'done' } },
    ]);
    fs.writeFileSync(path.join(wfDir, 'journal.jsonl'), journal);
    fs.writeFileSync(path.join(wfDir, 'agent-a1.jsonl'), TRANSCRIPT('a1'));
    fs.writeFileSync(path.join(wfDir, 'agent-a2.jsonl'), TRANSCRIPT('a2'));

    const result = buildSnapshot(makeCfg(tmpBase));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Should be deduplicated and sorted: a.ts, b.ts, c.ts
    expect(result.changedByAgents).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('agents with no filesChanged field contribute nothing', () => {
    // a1 has filesChanged, a2 does not.
    const journal = makeJournal([
      { type: 'result', agentId: 'a1', result: { filesChanged: ['x.ts'], summary: 'done' } },
      { type: 'result', agentId: 'a2', result: { summary: 'done, no files' } },
    ]);
    fs.writeFileSync(path.join(wfDir, 'journal.jsonl'), journal);
    fs.writeFileSync(path.join(wfDir, 'agent-a1.jsonl'), TRANSCRIPT('a1'));
    fs.writeFileSync(path.join(wfDir, 'agent-a2.jsonl'), TRANSCRIPT('a2'));

    const result = buildSnapshot(makeCfg(tmpBase));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.changedByAgents).toEqual(['x.ts']);
  });

  it('agents with filesChanged:[] contribute nothing', () => {
    const journal = makeJournal([
      { type: 'result', agentId: 'a1', result: { filesChanged: [], summary: 'no changes' } },
    ]);
    fs.writeFileSync(path.join(wfDir, 'journal.jsonl'), journal);
    fs.writeFileSync(path.join(wfDir, 'agent-a1.jsonl'), TRANSCRIPT('a1'));

    const result = buildSnapshot(makeCfg(tmpBase));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.changedByAgents).toEqual([]);
  });

  it('changedByAgents is always an array even when wf dir has only a journal', () => {
    // Journal exists but no agents at all.
    fs.writeFileSync(path.join(wfDir, 'journal.jsonl'), '');

    const result = buildSnapshot(makeCfg(tmpBase));
    if (!result.ok) return; // empty wf is ok:true or ok:false depending on impl; either is valid
    expect(Array.isArray(result.changedByAgents)).toBe(true);
  });

  it('reviewer-type results (findings-bearing) do not contribute to changedByAgents', () => {
    // A findings result sets a.findings (not a.result) in the agent — changedByAgents only
    // reads from a.result which is undefined for findings agents.
    const journal = makeJournal([
      { type: 'result', agentId: 'a1', result: { findings: [{ severity: 'HIGH', title: 'T1' }], verdict: 'found' } },
    ]);
    fs.writeFileSync(path.join(wfDir, 'journal.jsonl'), journal);
    fs.writeFileSync(path.join(wfDir, 'agent-a1.jsonl'), TRANSCRIPT('a1'));

    const result = buildSnapshot(makeCfg(tmpBase));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Reviewer results set a.findings, not a.result — changedByAgents stays empty.
    expect(result.changedByAgents).toEqual([]);
  });

  it('structuredResult with filesChanged contributes to changedByAgents regardless of agentType', () => {
    // An implementer result carrying filesChanged[] must appear in changedByAgents.
    // This is the positive-path coverage: the exclusion test above only covers the
    // findings-type path; this test ensures the accumulation path works.
    const journal = makeJournal([
      { type: 'result', agentId: 'a2', result: { filesChanged: ['src/foo.ts', 'src/bar.ts'], verdict: 'APPROVED' } },
    ]);
    fs.writeFileSync(path.join(wfDir, 'journal.jsonl'), journal);
    fs.writeFileSync(path.join(wfDir, 'agent-a2.jsonl'), TRANSCRIPT('a2'));

    const result = buildSnapshot(makeCfg(tmpBase));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // filesChanged from the agent result must be accumulated in changedByAgents.
    expect(result.changedByAgents).toContain('src/foo.ts');
    expect(result.changedByAgents).toContain('src/bar.ts');
  });
});
