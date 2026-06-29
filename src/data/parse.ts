import * as fs from 'fs';

export const STALE_SECS = 180;

// Known agentType → { label, key } mapping.
// agentType comes from agent-<id>.meta.json and is the most reliable role signal —
// it is set by the workflow author, not derived heuristically from prompt text.
// Strip the 'workflow-plugins:' namespace prefix before lookup.
// Returns null when agentType is absent, empty, or not in this map (caller falls
// back to classify() / deriveLabel()).
export interface AgentTypeLabel {
  label: string;
  key: string;
}

const AGENT_TYPE_MAP: Readonly<Record<string, AgentTypeLabel>> = {
  'implementer':          { label: 'Implement/Fix',  key: 'implementer' },
  'architect':            { label: 'Architecture',   key: 'architect' },
  'code-reviewer':        { label: 'Code review',    key: 'code_reviewer' },
  'security-reviewer':    { label: 'Security',       key: 'security_reviewer' },
  'uiux-reviewer':        { label: 'UI/UX',          key: 'uiux_reviewer' },
  'test-verifier':        { label: 'Verify',         key: 'test_verifier' },
  'completeness-critic':  { label: 'Completeness',   key: 'completeness_critic' },
};

// Strip the optional 'workflow-plugins:' namespace prefix that the Claude Code
// workflow plugin emits in agentType, then look up the clean type in AGENT_TYPE_MAP.
// Returns null when agentType is absent, empty, or unrecognised.
export function agentTypeToLabel(agentType: unknown): AgentTypeLabel | null {
  if (typeof agentType !== 'string' || !agentType) return null;
  // Strip namespace prefix (e.g. 'workflow-plugins:implementer' → 'implementer').
  const clean = agentType.replace(/^[^:]+:/, '');
  return AGENT_TYPE_MAP[clean] ?? null;
}

// Default role-labelling rules — neutral generic set covering common Claude Code
// workflow patterns. Matched against the first line of each agent's first user prompt.
// Used ONLY as fallback when agentType is absent or unknown (see agentTypeToLabel above).
// Users with workflow-specific roles should configure claudeWorkflow.roleRules in
// VS Code settings instead of relying on these defaults.
// Example user setting for a custom review workflow:
//   "claudeWorkflow.roleRules": [
//     { "re": "You are.*the lead reviewer", "label": "Lead Reviewer", "key": "lead" },
//     { "re": "You are.*implementing", "label": "Implementer", "key": "impl" }
//   ]
export const DEFAULT_ROLE_RULES: RoleRule[] = [
  { re: 'You are.*(reviewer|reviewing|review)', label: 'Reviewer', key: 'review' },
  { re: 'You are.*(fix|implement|implementer)', label: 'Implementer', key: 'fix' },
  { re: 'You are.*(verif|tester|test)', label: 'Verifier', key: 'verify' },
  { re: 'You are.*(plan|architect|designer)', label: 'Planner', key: 'plan' },
  { re: 'You are.*(research|investigat)', label: 'Researcher', key: 'research' },
  { re: 'You are.*(judge|judg)', label: 'Judge', key: 'judge' },
  { re: 'You are.*(synthesiz|summariz)', label: 'Synthesizer', key: 'synthesize' },
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
  /** input_tokens summed across assistant turns — only present when the field
   *  exists in at least one usage record; undefined otherwise (never 0-as-real). */
  inTok?: number;
  /** cache_creation_input_tokens summed — only present when field exists in transcript. */
  cacheCreate?: number;
  /** cache_read_input_tokens summed — only present when field exists in transcript. */
  cacheRead?: number;
}

export interface ClassifyResult {
  label: string;
  key: string;
}

// Maximum file size in bytes that jload() will read. Files larger than this are
// skipped and treated as empty (returns []). Prevents blocking the Extension Host
// event loop on a runaway transcript that grows to hundreds of megabytes.
// 10 MB is generous for any realistic workflow run; adjust in settings if needed.
export const MAX_JSONL_BYTES = 10 * 1024 * 1024; // 10 MiB

// Tolerant JSONL parser — skips blank lines and partial trailing lines.
export function jload(p: string): unknown[] {
  const out: unknown[] = [];
  let data: string;
  try {
    // Guard against oversized files before reading to avoid blocking the event loop.
    try {
      /* c8 ignore next */ // size guard: ESM module prevents vi.spyOn(fs,'statSync') — creating a 10 MiB fixture is impractical in unit tests
      if (fs.statSync(p).size > MAX_JSONL_BYTES) return out;
    } catch {
      // stat failed (e.g. file does not exist yet) — fall through to readFileSync
      // which will also fail and return [].
    }
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

// Maximum length for a roleRule regex pattern. Patterns beyond this length are
// silently skipped — unbounded patterns from user settings can cause
// catastrophic backtracking (ReDoS) in the extension host Node.js process.
// Note: a length cap alone is insufficient against crafted short patterns like
// (a+)+ or ([a-z]+)*. For user-supplied rules, an execution-time deadline is
// enforced below (CLASSIFY_MATCH_TIMEOUT_MS). DEFAULT_ROLE_RULES are
// hardcoded and trusted, so the deadline adds defence-in-depth for them too.
export const MAX_ROLE_RULE_RE_LEN = 500;

// Maximum milliseconds allowed for a single RegExp.test() call against a
// user-supplied roleRule. If the elapsed time exceeds this limit the rule is
// skipped.
//
// IMPORTANT: this check fires AFTER test() returns — a catastrophically
// backtracking pattern (e.g. (a+)+ against a long string) will still block
// the Node.js event loop for the full duration before this guard fires.
// The length cap (MAX_ROLE_RULE_RE_LEN) is the primary defence; this guard
// is a trip-wire for patterns that slip past it, not a true deadline.
// For a true deadline a worker_threads approach would be needed (TODO(tech-debt)).
// Deferred from M2: the structural ReDoS guard (REDOS_DANGER_RE) plus the
// length cap already block all known catastrophic patterns; worker_threads
// isolation is a defence-in-depth improvement explicitly deferred from M2.
// See the TOCTOU pattern in snapshot.ts for the analogous c8 ignore usage.
const CLASSIFY_MATCH_TIMEOUT_MS = 50;

// Structural heuristic to reject catastrophically backtracking regex patterns
// before constructing them. Patterns with quantified groups over quantified atoms
// (e.g. (a+)+, ([a-z]+)*, (?:a+)+, (?<n>a+)+) are the canonical ReDoS signatures
// and are rejected. The pattern covers capturing groups, non-capturing (?:…),
// named (?<name>…), lookahead (?=…), and negative lookahead (?!…) prefixes.
// This heuristic catches the common cases that slip past the length cap.
// Note: this is a best-effort safety valve — worker_threads isolation (TODO(tech-debt))
// is the correct long-term fix for user-supplied patterns. Coverage gaps remain
// for exotic alternation forms like (a|a)+ — the elapsed-time check is the
// secondary trip-wire for patterns that evade this structural guard.
// eslint-disable-next-line security/detect-unsafe-regex -- this IS the ReDoS guard pattern, not a vulnerable regex
const REDOS_DANGER_RE = /\((?:\?(?::|<[^>]+>|=|!))?[^)]*[+*{][^)]*\)[+*?{]/;

export function classify(text: string, roleRules: RoleRule[]): ClassifyResult {
  // Match role rules against ONLY the first line — the agent's role declaration
  // (e.g. "You are the reviewer (architect) …"). Matching the whole prompt
  // mislabels agents whose body embeds other roles' text: a fix-prompt embeds
  // the findings JSON, so a finding whose text embeds another role's keywords used to
  // trip the wrong rule. Legitimate role declarations live on the first line, so
  // this preserves intended matches while ignoring embedded data. (M1 #2.)
  const head = text.split('\n', 1)[0] ?? '';
  for (const r of roleRules) {
    if (!r.re || r.re.length > MAX_ROLE_RULE_RE_LEN) continue;
    // Structural ReDoS guard: reject patterns matching the canonical catastrophic
    // backtracking signature (quantified group over quantified atom, e.g. (a+)+).
    // These can block the Extension Host event loop even on short inputs.
    if (REDOS_DANGER_RE.test(r.re)) continue;
    try {
      const start = Date.now();
      // eslint-disable-next-line security/detect-non-literal-regexp -- user-supplied pattern, guarded by length cap + structural check + elapsed-time trip-wire above
      const matched = new RegExp(r.re, 'i').test(head);
      /* c8 ignore next */ // ReDoS guard: timing-dependent path; untestable without Date.now mocking — see TOCTOU pattern in snapshot.ts
      if (Date.now() - start > CLASSIFY_MATCH_TIMEOUT_MS) continue;
      if (matched) {
        return { label: r.label, key: r.key ?? r.label.toLowerCase() };
      }
    } catch {
      // The regex failed to compile (invalid pattern that passed length + structural checks).
      // Skip this rule entirely rather than falling back to a literal-string match, which
      // would silently produce wrong results for patterns like '\d+' that users intend as regex.
      continue;
    }
  }
  const lbl = deriveLabel(text);
  return { label: lbl, key: lbl.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24) };
}

export function agentStats(events: unknown[]): AgentStats {
  let outTok = 0;
  let tools = 0;
  const tail: TailEntry[] = [];
  // Optional token fields — only accumulated when the field is present in at
  // least one usage record. Using undefined-accumulation (not 0) ensures that
  // an agent whose transcript has no input_tokens field never reports 0 as if
  // it were a real measurement. The first numeric occurrence initialises the
  // accumulator; subsequent ones add to it.
  let inTok: number | undefined;
  let cacheCreate: number | undefined;
  let cacheRead: number | undefined;

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
      // Optional fields: guard typeof strictly — absent fields must stay undefined.
      if (typeof u['input_tokens'] === 'number') inTok = (inTok ?? 0) + (u['input_tokens'] as number);
      if (typeof u['cache_creation_input_tokens'] === 'number') cacheCreate = (cacheCreate ?? 0) + (u['cache_creation_input_tokens'] as number);
      if (typeof u['cache_read_input_tokens'] === 'number') cacheRead = (cacheRead ?? 0) + (u['cache_read_input_tokens'] as number);
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
        const toolName = typeof block['name'] === 'string' ? block['name'] : '(unknown)';
        tail.push({ kind: 'tool', text: `[${toolName}] ${inp}` });
      } else if (block['type'] === 'text' && (typeof block['text'] === 'string') && (block['text'] as string).trim()) {
        tail.push({ kind: 'text', text: (block['text'] as string).trim() });
      }
    }
  }
  const result: AgentStats = { outTok, tools, tail: tail.slice(-30) };
  if (inTok !== undefined) result.inTok = inTok;
  if (cacheCreate !== undefined) result.cacheCreate = cacheCreate;
  if (cacheRead !== undefined) result.cacheRead = cacheRead;
  return result;
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
