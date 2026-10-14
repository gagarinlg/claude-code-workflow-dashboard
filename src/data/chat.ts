// Cross-agent chat discovery + parsing for the Chat tab.
//
// The RADIODATA workflow plugin's reviewer agents communicate through an
// append-only markdown file so they can raise cross-domain observations and
// address each other with `@Agent` tags, then run a discussion phase until all
// return SATISFIED. Two file-naming conventions exist and both are supported:
//   .review-tmp/team-review-<scope>-<timestamp>.md   (existing /full-audit convention)
//   .review-tmp/chat-<runId>.md                      (dashboard-mode convention)
//
// The records directory is configurable (Cfg.recordsDir / claudeWorkflow.recordsDir)
// and `.review-tmp` is only the *default* — never hard-coded as the only
// possibility. Discovery prefers a direct, cheap lookup in the (configured or
// default) records directory and only falls back to a bounded recursive scan
// when that comes up empty, so the common case never pays for a tree walk.
//
// Everything here is read-only and defensive: a malformed or garbage chat file
// must never throw and must never lose content — when no structured turns can
// be detected, the whole file is surfaced as a single raw turn instead.
import * as fs from 'fs';
import * as path from 'path';

// Default sub-directory the workflow plugin writes chat/review records to.
export const DEFAULT_RECORDS_DIR = '.review-tmp';

// Maximum bytes read from a chat file. Mirrors MAX_JSONL_BYTES (parse.ts) /
// MAX_META_BYTES (snapshot.ts): guards against a crafted or runaway file
// blocking the Extension Host event loop. A hand-written/LLM-appended markdown
// chat log realistically stays well under this; files above it are still shown,
// truncated, rather than skipped outright (never lose content silently).
export const MAX_CHAT_BYTES = 5 * 1024 * 1024; // 5 MiB

// Maximum number of parsed turns kept. Bounds render cost for a pathological
// file with an enormous number of headings; the most recent turns win.
export const MAX_CHAT_TURNS = 500;

// Bounded recursive fallback scan parameters — mirrors the shape of the
// walkers in discovery.ts/changed.ts (bounded depth, soft file-count cap,
// skip node_modules/vendor/hidden dirs). Exported so unit tests can verify
// the limits are enforced without constructing pathological fixtures for
// every call site — mirrors WALK_FILE_LIMIT in changed.ts.
export const SCAN_MAX_DEPTH = 4;
export const SCAN_FILE_LIMIT = 2000;

export interface ChatFileCandidate {
  path: string;
  mtimeMs: number;
  /** runId parsed out of a `chat-<runId>.md` filename; null for the
   *  `team-review-*` convention (which encodes scope+timestamp, not a run id)
   *  or any unrecognised name. */
  runId: string | null;
}

const CHAT_FILE_RE = /^chat-(.+)\.md$/;
const TEAM_REVIEW_FILE_RE = /^team-review-.+\.md$/;

function matchCandidateName(name: string): { runId: string | null } | null {
  const chatM = CHAT_FILE_RE.exec(name);
  if (chatM) return { runId: chatM[1] ?? null };
  if (TEAM_REVIEW_FILE_RE.test(name)) return { runId: null };
  return null;
}

// List candidate chat/review record files directly inside dir (non-recursive).
// Defensive: any readdirSync/statSync failure degrades to "no candidates here",
// never throws.
function listCandidatesIn(dir: string): ChatFileCandidate[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ChatFileCandidate[] = [];
  for (const e of entries) {
    // Skip symlinks — mirrors the symlink-safety pattern used throughout
    // discovery.ts/changed.ts/snapshot.ts.
    if (!e.isFile() || e.isSymbolicLink()) continue;
    const m = matchCandidateName(e.name);
    if (!m) continue;
    const p = path.join(dir, e.name);
    try {
      const st = fs.statSync(p);
      out.push({ path: p, mtimeMs: st.mtimeMs, runId: m.runId });
    } catch {
      /* c8 ignore next */ // TOCTOU: file vanished between readdir and stat — untestable without mocking fs
      continue;
    }
  }
  return out;
}

// Bounded recursive fallback scan, used only when the configured/default
// records dir does not exist or holds no candidates at the workspace root —
// e.g. a differently-named or nested records directory. Hidden directories
// (including a nested `.review-tmp`) are skipped, matching the existing
// walker convention in discovery.ts/changed.ts; the direct lookup above
// already covers the common top-level `.review-tmp` case.
function scanForCandidates(root: string, depth: number): ChatFileCandidate[] {
  const out: ChatFileCandidate[] = [];
  let visited = 0;
  const visit = (dir: string, d: number): void => {
    if (d < 0 || visited >= SCAN_FILE_LIMIT) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (visited >= SCAN_FILE_LIMIT) return;
      if (e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'vendor' || e.name.startsWith('.')) continue;
        visit(p, d - 1);
      } else if (e.isFile()) {
        visited++;
        const m = matchCandidateName(e.name);
        if (!m) continue;
        try {
          const st = fs.statSync(p);
          out.push({ path: p, mtimeMs: st.mtimeMs, runId: m.runId });
        } catch {
          /* c8 ignore next */ // TOCTOU: file vanished between readdir and stat — untestable without mocking fs
          continue;
        }
      }
    }
  };
  visit(root, depth);
  return out;
}

/**
 * Find every chat/team-review record file across the given workspace folders.
 * Tries the (configured or default) records directory directly in each folder
 * first; only falls back to a bounded recursive scan when that yields nothing,
 * so the common case (`.review-tmp` at the workspace root) never pays for a
 * tree walk. Never throws — an inaccessible folder simply contributes no
 * candidates.
 */
export function findChatFiles(workspaceFolders: readonly string[], recordsDir?: string): ChatFileCandidate[] {
  const dirName = recordsDir && recordsDir.trim() ? recordsDir.trim() : DEFAULT_RECORDS_DIR;
  const direct: ChatFileCandidate[] = [];
  for (const folder of workspaceFolders) {
    if (!folder) continue;
    direct.push(...listCandidatesIn(path.join(folder, dirName)));
  }
  if (direct.length) return direct;
  const scanned: ChatFileCandidate[] = [];
  for (const folder of workspaceFolders) {
    if (!folder) continue;
    scanned.push(...scanForCandidates(folder, SCAN_MAX_DEPTH));
  }
  return scanned;
}

/**
 * Resolve the single chat file most relevant to runId: an exact
 * `chat-<runId>.md` match wins (newest if several workspace folders somehow
 * produced more than one); otherwise a `team-review-*` (or any other
 * candidate) whose filename embeds runId as a substring; otherwise the most
 * recently modified candidate found anywhere. Returns null when no candidate
 * exists at all.
 */
export function resolveChatFile(
  workspaceFolders: readonly string[],
  runId: string | undefined,
  recordsDir?: string,
): ChatFileCandidate | null {
  const candidates = findChatFiles(workspaceFolders, recordsDir);
  if (!candidates.length) return null;
  const newest = (list: ChatFileCandidate[]): ChatFileCandidate =>
    list.reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a));
  if (runId) {
    const exact = candidates.filter((c) => c.runId === runId);
    if (exact.length) return newest(exact);
    const byName = candidates.filter((c) => path.basename(c.path).includes(runId));
    if (byName.length) return newest(byName);
  }
  return newest(candidates);
}

export interface ChatFileRead {
  raw: string;
  mtimeMs: number;
  /** True when the file exceeded MAX_CHAT_BYTES and was read only up to that cap. */
  truncated: boolean;
}

/**
 * Read a chat file's content defensively, capped at MAX_CHAT_BYTES. Returns
 * null for any failure (missing, not a regular file, permission denied, …) —
 * never throws.
 */
export function readChatFile(filePath: string): ChatFileRead | null {
  let st: fs.Stats;
  try {
    st = fs.statSync(filePath);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const truncated = st.size > MAX_CHAT_BYTES;
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return null;
  }
  try {
    const len = truncated ? MAX_CHAT_BYTES : st.size;
    const buf = Buffer.allocUnsafe(len);
    const n = fs.readSync(fd, buf, 0, len, 0);
    return { raw: buf.toString('utf8', 0, n), mtimeMs: st.mtimeMs, truncated };
  } catch {
    /* c8 ignore next */ // TOCTOU: read error after a successful open — untestable without mocking fs
    return null;
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface ChatTurn {
  author: string;
  /** Agent names mentioned via `@tag` in this turn's header line. */
  addressed: string[];
  /** Raw timestamp substring if one was detected in the header line. */
  timestamp?: string;
  body: string;
}

export interface ChatThread {
  turns: ChatTurn[];
  /** True when no structured turn boundaries were detected and the whole file
   *  was kept as a single turn — degrade gracefully, never drop content. */
  malformed: boolean;
  /** True when more turns were found than MAX_CHAT_TURNS; only the most
   *  recent MAX_CHAT_TURNS are kept. */
  turnsCapped: boolean;
}

// Matches an ISO-8601-ish timestamp, loosely: date + time, optional seconds,
// fractional seconds, and 'Z' or a numeric UTC offset. Deliberately permissive
// — this only drives *display*, never structural decisions, so a partial
// match is fine and a non-match degrades to "no timestamp shown".
// Linear: every quantifier applies to a disjoint, non-nested group (fixed digit
// counts plus independent optional suffixes); there is no (x+)+-style nesting,
// so no catastrophic backtracking is possible.
// eslint-disable-next-line security/detect-unsafe-regex -- see comment above
const TIMESTAMP_RE = /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\b/;
// @Name mentions. Bounded length prevents a pathological run of '@' characters
// from producing unbounded match work (the character class itself is linear,
// but the length cap keeps a single capture small and predictable).
const TAG_RE = /@([A-Za-z][A-Za-z0-9_-]{0,40})/g;
const HEADING_RE = /^#{1,6}\s+.*$/;
const HR_RE = /^-{3,}\s*$/;

/** Unique `@tag` mentions in s, in first-seen order. Bounded iteration count
 *  defends against a pathologically long single line. */
function extractTags(s: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = TAG_RE.exec(s)) && guard++ < 1000) {
    const name = m[1];
    if (name && !seen.has(name)) { seen.add(name); out.push(name); }
  }
  return out;
}

// Header lines are short role declarations in practice (e.g. "## Klaus (security-reviewer) [...]").
// Capping defends against a pathological single line with no newline (up to the
// MAX_CHAT_BYTES file cap) driving repeated regex/replace work below.
const MAX_HEADER_LINE_CHARS = 2000;

/** Parse one turn's header line into author / addressed / timestamp. Never
 *  throws; an unparseable header degrades to author:'Unknown'. */
function parseHeaderLine(line: string): { author: string; addressed: string[]; timestamp?: string } {
  let rest = (line.length > MAX_HEADER_LINE_CHARS ? line.slice(0, MAX_HEADER_LINE_CHARS) : line).trim();
  // Strip leading structural markers: ATX heading hashes, list/quote markers.
  rest = rest.replace(/^#+\s*/, '').replace(/^[-*>]\s*/, '');
  const tsM = TIMESTAMP_RE.exec(rest);
  const timestamp = tsM ? tsM[1] : undefined;
  const addressed = extractTags(rest);
  if (tsM) rest = rest.replace(tsM[0], ' ');
  rest = rest.replace(TAG_RE, ' ');
  // Strip decorative markdown punctuation and collapse whitespace to recover
  // a readable author name, e.g. "**Klaus (security-reviewer):**" -> "Klaus (security-reviewer)".
  rest = rest.replace(/[[\]*_]/g, ' ').replace(/[:\-–—]+\s*$/, '').replace(/\s+/g, ' ').trim();
  const author = rest || 'Unknown';
  const result: { author: string; addressed: string[]; timestamp?: string } = { author, addressed };
  if (timestamp) result.timestamp = timestamp;
  return result;
}

/**
 * Parse an append-only chat/team-review markdown file into structured turns.
 * Defensive by construction: this file is written by LLM agents, so the
 * format WILL sometimes deviate. Never throws — any unexpected error or
 * absence of recognisable structure degrades to a single turn holding the
 * raw text, so content is never silently lost.
 */
export function parseChatThread(raw: string): ChatThread {
  try {
    return parseChatThreadUnsafe(raw);
  } catch {
    // Belt-and-suspenders: parseChatThreadUnsafe is written entirely from safe,
    // guarded operations (string methods, bounded-iteration regex loops) and
    // does not throw in practice — this path requires a genuine unguarded throw
    // slipping past those guards. Mirrors the outer catch in buildSnapshot()
    // (src/data/snapshot.ts).
    /* c8 ignore next 4 */
    const trimmed = raw.trim();
    if (!trimmed) return { turns: [], malformed: false, turnsCapped: false };
    return { turns: [{ author: 'Unknown', addressed: [], body: trimmed }], malformed: true, turnsCapped: false };
  }
}

function singleRawTurn(text: string): ChatThread {
  const trimmed = text.trim();
  if (!trimmed) return { turns: [], malformed: false, turnsCapped: false };
  return { turns: [{ author: 'Unknown', addressed: extractTags(trimmed), body: trimmed }], malformed: true, turnsCapped: false };
}

function parseChatThreadUnsafe(raw: string): ChatThread {
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n');

  // Pass 1: heading-style turn boundaries ("## Author ...").
  const boundaries: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i] ?? '')) boundaries.push(i);
  }

  // Pass 2 (fallback): no headings — try '---' horizontal-rule separators, a
  // convention some append-only writers use between entries. The line right
  // after the rule is treated as the header line for that entry. A virtual
  // boundary at -1 is prepended so the FIRST entry (before any literal '---')
  // is captured too — without it, whatever precedes the first separator would
  // be silently dropped instead of becoming the first turn.
  let useHr = false;
  if (!boundaries.length) {
    for (let i = 0; i < lines.length; i++) {
      if (HR_RE.test(lines[i] ?? '')) { boundaries.push(i); useHr = true; }
    }
    if (useHr) boundaries.unshift(-1);
  }

  if (!boundaries.length) return singleRawTurn(text);

  const turns: ChatTurn[] = [];
  for (let bi = 0; bi < boundaries.length; bi++) {
    const start = boundaries[bi] as number;
    const end = bi + 1 < boundaries.length ? (boundaries[bi + 1] as number) : lines.length;
    const headerIdx = useHr ? start + 1 : start;
    if (headerIdx >= end) continue; // '---' with nothing after it before the next boundary
    const headerLine = lines[headerIdx] ?? '';
    const body = lines.slice(headerIdx + 1, end).join('\n').trim();
    const { author, addressed, timestamp } = parseHeaderLine(headerLine);
    // Skip a boundary that produced nothing at all (e.g. a stray '---' or an
    // empty '##' line) — not a real turn.
    if (!body && author === 'Unknown' && !timestamp && !addressed.length) continue;
    const turn: ChatTurn = { author, addressed, body };
    if (timestamp) turn.timestamp = timestamp;
    turns.push(turn);
  }

  if (!turns.length) return singleRawTurn(text);

  const turnsCapped = turns.length > MAX_CHAT_TURNS;
  const kept = turnsCapped ? turns.slice(turns.length - MAX_CHAT_TURNS) : turns;
  return { turns: kept, malformed: false, turnsCapped };
}

// ---------------------------------------------------------------------------
// Orchestration — used by snapshot.ts
// ---------------------------------------------------------------------------

export interface ChatFileSnapshot {
  /** Basename only (never an absolute path) — mirrors the workflowDir
   *  information-disclosure precedent in snapshot.ts/extension.ts. */
  sourceFile: string;
  /** ISO 8601 timestamp of the chat file's mtime. */
  updatedAt: string;
  turns: ChatTurn[];
  malformed: boolean;
  turnsCapped: boolean;
  /** True when the raw file exceeded MAX_CHAT_BYTES and was read truncated. */
  truncated: boolean;
}

/** Read + parse filePath into a ChatFileSnapshot. Returns null when the file
 *  is unreadable or parses to zero turns (nothing to show). */
export function loadChatFile(filePath: string): ChatFileSnapshot | null {
  const read = readChatFile(filePath);
  if (!read) return null;
  const thread = parseChatThread(read.raw);
  if (!thread.turns.length) return null;
  return {
    sourceFile: path.basename(filePath),
    updatedAt: new Date(read.mtimeMs).toISOString(),
    turns: thread.turns,
    malformed: thread.malformed,
    turnsCapped: thread.turnsCapped,
    truncated: read.truncated,
  };
}
