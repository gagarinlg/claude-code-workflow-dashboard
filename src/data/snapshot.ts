import * as fs from 'fs';
import * as path from 'path';
import { findWorkflowDir } from './discovery';
import { jload, firstUserText, classify, agentStats, sevCounts, STALE_SECS } from './parse';
import { walkChanged } from './changed';

// --- Exported types mirroring docs/DATA-FORMAT.md ---

export interface RoleRule {
  re: string;
  label: string;
  key?: string;
}

export interface Cfg {
  base: string;
  repo: string;
  refreshMs: number;
  statusBar: boolean;
  roleRules: RoleRule[];
}

export interface TailEntry {
  kind: 'tool' | 'text';
  text: string;
}

export interface Finding {
  severity?: string;
  title?: string;
  why?: string;
  fix?: string;
  location?: string;
  pass?: number;
  reviewer?: string;
  key?: string;
  [key: string]: unknown;
}

export interface Verdict {
  [label: string]: string;
}

export interface LoopStats {
  phase: string;
  live: number;
  done: number;
  dead: number;
  total: number;
  outTok: number;
  tools: number;
  passes: number;
  findings: number;
  sevTotals: Record<string, number>;
}

export interface StructuredResult {
  pass: number;
  label: string;
  key: string;
  result: Record<string, unknown>;
}

export interface Agent {
  id: string;
  label: string;
  key: string;
  status: 'run' | 'done' | 'dead';
  elapsed: number;
  tokens: number;
  tools: number;
  tail: TailEntry[];
  lastActivity: string;
  start: number;
  mtime: number;
  idx?: number;
  findings?: Finding[];
  verdict?: string;
  result?: Record<string, unknown>;
  resultText?: string;
}

export type SnapshotOk = {
  ok: true;
  runId: string;
  workflowDir: string;
  updatedAt: string;
  loop: LoopStats;
  labels: string[];
  agents: Agent[];
  allFindings: Finding[];
  structuredResults: StructuredResult[];
  verdicts: Verdict;
  changed: string[] | null;
};

export type SnapshotErr = {
  ok: false;
  msg: string;
};

export type Snapshot = SnapshotOk | SnapshotErr;

// --- buildSnapshot ---

export function buildSnapshot(cfg: Cfg): Snapshot {
  const wfDir = findWorkflowDir(cfg.base);
  if (!wfDir) return { ok: false, msg: `No workflow run (wf_*) found under ${cfg.base}` };
  const now = Date.now() / 1000;
  const journal = jload(path.join(wfDir, 'journal.jsonl'));
  const doneIds = new Set(
    journal
      .filter((o) => {
        if (o == null || typeof o !== 'object') return false;
        return (o as Record<string, unknown>)['type'] === 'result';
      })
      .map((o) => (o as Record<string, unknown>)['agentId'] as string)
  );
  const resultByAgent: Record<string, unknown> = {};
  for (const o of journal) {
    if (o == null || typeof o !== 'object') continue;
    const obj = o as Record<string, unknown>;
    if (obj['type'] === 'result') {
      resultByAgent[obj['agentId'] as string] = obj['result'];
    }
  }

  let files: string[] = [];
  try {
    files = fs.readdirSync(wfDir).filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl'));
  } catch {}
  const agents: Agent[] = [];
  for (const fn of files) {
    const aid = fn.slice('agent-'.length, -'.jsonl'.length);
    const fp = path.join(wfDir, fn);
    const events = jload(fp);
    if (!events.length) continue;
    const { label, key } = classify(firstUserText(events), cfg.roleRules);

    let start: number;
    const metaP = path.join(wfDir, `agent-${aid}.meta.json`);
    try {
      start = fs.statSync(metaP).mtimeMs / 1000;
    } catch {
      // meta.json absent — fall back to transcript mtime
      try {
        start = fs.statSync(fp).mtimeMs / 1000;
      } catch {
        // TOCTOU: transcript disappeared between readdir and statSync; skip agent
        continue;
      }
    }

    // transcript mtime for status / elapsed — wrap per same TOCTOU fix
    let mtime: number;
    try {
      mtime = fs.statSync(fp).mtimeMs / 1000;
    } catch {
      continue;
    }

    const status: Agent['status'] = doneIds.has(aid) ? 'done' : (now - mtime < STALE_SECS ? 'run' : 'dead');
    const { outTok, tools, tail } = agentStats(events);
    const res = resultByAgent[aid];
    const a: Agent = {
      id: aid, label, key, status,
      elapsed: status === 'run' ? Math.round(now - start) : Math.round(mtime - start),
      tokens: outTok, tools, tail,
      lastActivity: tail.length ? (tail[tail.length - 1]?.text ?? '(starting…)') : '(starting…)',
      start, mtime,
    };
    if (res && typeof res === 'object' && Array.isArray((res as Record<string, unknown>)['findings'])) {
      a.findings = (res as Record<string, unknown>)['findings'] as Finding[];
      a.verdict = ((res as Record<string, unknown>)['verdict'] as string) || '';
    } else if (res && typeof res === 'object') {
      a.result = res as Record<string, unknown>;
    } else if (typeof res === 'string') {
      a.resultText = res;
    }
    agents.push(a);
  }
  agents.sort((x, y) => x.start - y.start);
  agents.forEach((a, i) => { a.idx = i + 1; });

  const seen: Record<string, number> = {};
  const allFindings: Finding[] = [];
  const verdicts: Verdict = {};
  const structuredResults: StructuredResult[] = [];
  for (const o of journal) {
    if (o == null || typeof o !== 'object') continue;
    const obj = o as Record<string, unknown>;
    if (obj['type'] !== 'result') continue;
    const res = obj['result'];
    const a = agents.find((x) => x.id === (obj['agentId'] as string));
    const label = a ? a.label : 'agent';
    const key = a ? a.key : '?';
    if (res && typeof res === 'object' && Array.isArray((res as Record<string, unknown>)['findings'])) {
      seen[key] = (seen[key] ?? 0) + 1;
      const pass = seen[key] as number;
      verdicts[label] = (((res as Record<string, unknown>)['verdict'] as string) || '').replace(/\n/g, ' ');
      for (const f of (res as Record<string, unknown>)['findings'] as Finding[]) {
        allFindings.push({ pass, reviewer: label, key, ...f });
      }
    } else if (res && typeof res === 'object') {
      seen[key] = (seen[key] ?? 0) + 1;
      structuredResults.push({ pass: seen[key] as number, label, key, result: res as Record<string, unknown> });
    }
  }

  const live = agents.filter((a) => a.status === 'run');
  let phase = live.length ? 'Working' : 'idle / between passes';
  if (live.length) {
    phase = live.reduce((p, c) => (c.mtime > p.mtime ? c : p)).label;
  }

  return {
    ok: true,
    runId: path.basename(wfDir),
    workflowDir: wfDir,
    updatedAt: new Date().toLocaleTimeString(),
    loop: {
      phase,
      live: live.length,
      done: agents.filter((a) => a.status === 'done').length,
      dead: agents.filter((a) => a.status === 'dead').length,
      total: agents.length,
      outTok: agents.reduce((s, a) => s + a.tokens, 0),
      tools: agents.reduce((s, a) => s + a.tools, 0),
      passes: Math.max(0, ...Object.values(seen)),
      findings: allFindings.length,
      sevTotals: sevCounts(allFindings),
    },
    labels: [...new Set(allFindings.map((f) => f.reviewer ?? ''))],
    agents,
    allFindings,
    structuredResults,
    verdicts,
    changed: cfg.repo ? walkChanged(cfg.repo, 120) : null,
  };
}
