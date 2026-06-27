import * as fs from 'fs';

export const STALE_SECS = 90;

// Default role-labelling rules (workflow-specific niceties; the viewer works
// without them via deriveLabel()). Each: { re: <regex source>, label, key }.
// NOTE: these are currently hardcoded to the author's crm-notes workflow.
// M1 replaces them with a neutral generic set; personal rules go in
// claudeWorkflow.roleRules user settings.
export const DEFAULT_ROLE_RULES: RoleRule[] = [
  { re: 'SENIOR FULL-STACK DEVELOPER fixing', label: 'Fix', key: 'fix' },
  { re: 'build/test verifier', label: 'Verify', key: 'verify' },
  { re: 'GRUMPY, SENIOR FULL-STACK/BACKEND DEVELOPER reviewing', label: 'Dev review', key: 'dev' },
  { re: 'NITPICKY, GRUMPY, SENIOR UX DESIGNER', label: 'UX review', key: 'ux' },
  { re: 'NEXTCLOUD APP-STORE REVIEWER', label: 'Compliance', key: 'comp' },
];

export interface RoleRule {
  re: string;
  label: string;
  key?: string;
}

export interface TailEntry {
  kind: 'tool' | 'text';
  text: string;
}

export interface AgentStats {
  outTok: number;
  tools: number;
  tail: TailEntry[];
}

export interface ClassifyResult {
  label: string;
  key: string;
}

// Tolerant JSONL parser — skips blank lines and partial trailing lines.
export function jload(p: string): unknown[] {
  const out: unknown[] = [];
  let data: string;
  try {
    data = fs.readFileSync(p, 'utf8');
  } catch {
    return out;
  }
  for (const line of data.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s));
    } catch {
      /* partial trailing line */
    }
  }
  return out;
}

export function firstUserText(events: unknown[]): string {
  for (const o of events) {
    if (o == null || typeof o !== 'object') continue;
    const obj = o as Record<string, unknown>;
    if (obj['type'] === 'user') {
      const m = obj['message'] as Record<string, unknown> | undefined;
      const c = m && m['content'];
      if (typeof c === 'string') return c;
      if (Array.isArray(c)) {
        for (const b of c) {
          if (b && typeof b === 'object') {
            const block = b as Record<string, unknown>;
            if (block['type'] === 'text') return (block['text'] as string) || '';
          }
        }
      }
    }
  }
  return '';
}

export function deriveLabel(text: string): string {
  if (!text) return 'agent';
  const m = text.match(/You are (?:an?|the)\s+([^.,;:\n]{3,48})/i);
  if (m && m[1]) return m[1].trim().replace(/\s+/g, ' ');
  return text.replace(/\s+/g, ' ').slice(0, 40).trim() || 'agent';
}

export function classify(text: string, roleRules: RoleRule[]): ClassifyResult {
  for (const r of roleRules) {
    try {
      if (new RegExp(r.re, 'i').test(text)) {
        return { label: r.label, key: r.key ?? r.label.toLowerCase() };
      }
    } catch {
      if (text.includes(r.re)) {
        return { label: r.label, key: r.key ?? r.label.toLowerCase() };
      }
    }
  }
  const lbl = deriveLabel(text);
  return { label: lbl, key: lbl.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24) };
}

export function agentStats(events: unknown[]): AgentStats {
  let outTok = 0;
  let tools = 0;
  const tail: TailEntry[] = [];
  for (const o of events) {
    if (o == null || typeof o !== 'object') continue;
    const obj = o as Record<string, unknown>;
    if (obj['type'] !== 'assistant') continue;
    const m = obj['message'];
    if (!m || typeof m !== 'object') continue;
    const msg = m as Record<string, unknown>;
    const usage = msg['usage'];
    if (usage && typeof usage === 'object') {
      const u = usage as Record<string, unknown>;
      if (typeof u['output_tokens'] === 'number') outTok += u['output_tokens'] as number;
    }
    const content = msg['content'];
    for (const b of Array.isArray(content) ? content : []) {
      if (!b || typeof b !== 'object') continue;
      const block = b as Record<string, unknown>;
      if (block['type'] === 'tool_use') {
        tools++;
        let inp = '';
        try {
          inp = JSON.stringify(block['input']).slice(0, 180);
        } catch {}
        tail.push({ kind: 'tool', text: `[${block['name'] as string}] ${inp}` });
      } else if (block['type'] === 'text' && (typeof block['text'] === 'string') && (block['text'] as string).trim()) {
        tail.push({ kind: 'text', text: (block['text'] as string).trim() });
      }
    }
  }
  return { outTok, tools, tail: tail.slice(-30) };
}

export function sevCounts(findings: unknown[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const f of findings ?? []) {
    if (f == null || typeof f !== 'object') continue;
    const obj = f as Record<string, unknown>;
    const s = (obj['severity'] != null) ? String(obj['severity']) : 'UNRATED';
    c[s] = (c[s] ?? 0) + 1;
  }
  return c;
}
