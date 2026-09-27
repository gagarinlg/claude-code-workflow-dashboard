import * as fs from 'fs';
import { newAgentStats, foldAgentStats, cloneAgentStats, userEventText } from './parse';
import type { AgentStats } from './parse';

// Incremental JSONL reading.
//
// Every refresh used to re-read and JSON.parse every transcript of the run from
// the first byte, and the fs.watch callback fired a refresh on every append. With
// a dozen live agents that meant hundreds of MiB of synchronous parsing per second
// on the extension host thread that all extensions share (issue #3).
//
// The workflow files are append-only JSONL, so a follower remembers how many
// bytes of a file it has consumed and parses only what was appended since. Each
// line is folded into a small accumulator and then dropped, so memory no longer
// grows with transcript size either.

// Largest single read. A line longer than this is still read whole: the read
// grows until it reaches a newline or the end of the file.
const MAX_CHUNK = 8 * 1024 * 1024;

// Bytes one snapshot build may read, shared by every file it follows. When it is
// used up the remaining files keep their previous state and are finished by the
// next build. The budget is soft: a read always completes the line it started.
export interface ReadBudget {
  remaining: number;
  bytesRead: number;
}

export function newBudget(bytes: number): ReadBudget {
  return { remaining: bytes, bytesRead: 0 };
}

// How lines are folded into an accumulator of type A.
export interface FoldOps<A> {
  init(): A;
  fold(acc: A, value: unknown): void;
  clone(acc: A): A;
}

// The parsed state of a followed file: the accumulator and the number of JSON
// values folded into it (blank and unparseable lines are skipped, as in jload).
export interface FollowView<A> {
  acc: A;
  count: number;
}

interface Cursor {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  // Bytes consumed. Always 0 or just past a '\n', so decoding starts on a line
  // boundary (a '\n' byte never occurs inside a multi-byte UTF-8 sequence).
  offset: number;
}

export class JsonlFollower<A> {
  private cursor: Cursor | null = null;
  private committed: FollowView<A>;
  // committed plus the unterminated last line, when that line is valid JSON.
  // jload parses such a line too; it is re-read once its newline arrives.
  private view: FollowView<A>;
  // False while unread bytes remain because the budget ran out.
  complete = true;

  constructor(private readonly ops: FoldOps<A>) {
    this.committed = { acc: ops.init(), count: 0 };
    this.view = this.committed;
  }

  reset(): void {
    this.cursor = null;
    this.committed = { acc: this.ops.init(), count: 0 };
    this.view = this.committed;
    this.complete = true;
  }

  // Bring the view up to date with the file at fp and return it. `st` is a stat
  // of fp the caller already holds; it decides whether anything changed. A file
  // that is missing or unreadable yields an empty view, like jload's [].
  sync(fp: string, budget: ReadBudget, st?: fs.Stats): FollowView<A> {
    if (!st) {
      try {
        st = fs.statSync(fp);
      } catch {
        this.reset();
        return this.view;
      }
    }
    const c = this.cursor;
    if (c && this.complete && c.size === st.size && c.mtimeMs === st.mtimeMs && c.ino === st.ino && c.dev === st.dev) {
      return this.view;
    }
    if (budget.remaining <= 0) {
      this.complete = false;
      return this.view;
    }
    let fd: number;
    try {
      fd = fs.openSync(fp, 'r');
    } catch {
      this.reset();
      return this.view;
    }
    try {
      this.read(fd, budget);
    } catch {
      // Read error mid-file: drop the state so the next build starts over.
      this.reset();
    } finally {
      try { fs.closeSync(fd); } catch {}
    }
    return this.view;
  }

  private read(fd: number, budget: ReadBudget): void {
    const st = fs.fstatSync(fd);
    // Lowered below if a read shows the file got shorter after the fstat.
    let size = st.size;
    let c = this.cursor;
    // A replaced file (new inode) or a truncated one is read again from the start.
    if (c && (c.ino !== st.ino || c.dev !== st.dev || size < c.offset)) {
      this.reset();
      c = null;
    }
    if (c && c.offset > 0) {
      // The byte before the offset must still be the newline we stopped after.
      // If not, the file was rewritten in place: start over.
      const b = Buffer.alloc(1);
      if (fs.readSync(fd, b, 0, 1, c.offset - 1) !== 1 || b[0] !== 0x0a) {
        this.reset();
        c = null;
      }
    }
    let offset = c ? c.offset : 0;
    const { acc } = this.committed;
    let count = this.committed.count;
    let view: FollowView<A> | null = null;
    let atEof = offset >= size;
    let len = 0;
    // Set when a read held no newline and is retried larger. The first newline of
    // the larger read ends that long line, and only that line is consumed, so one
    // slice parses about max(budget, longest line) rather than twice the longest line.
    let grown = false;
    while (!atEof && budget.remaining > 0) {
      len = Math.max(len, Math.min(size - offset, MAX_CHUNK, Math.max(1, budget.remaining)));
      const buf = Buffer.allocUnsafe(len);
      const n = fs.readSync(fd, buf, 0, len, offset);
      if (n <= 0) {
        // The file shrank after fstat; the next build sees the truncation.
        size = offset;
        atEof = true;
        break;
      }
      const nl = grown ? buf.subarray(0, n).indexOf(0x0a) : buf.lastIndexOf(0x0a, n - 1);
      if (nl < 0) {
        // A short read is the end of the file too: it shrank after the fstat.
        // Without this check the retry below would re-read the same bytes forever.
        if (n < len || offset + n >= size) {
          // Unterminated last line: parse it tentatively without consuming it.
          size = offset + n;
          atEof = true;
          const s = buf.toString('utf8', 0, n).trim();
          if (s) {
            try {
              const v: unknown = JSON.parse(s);
              const a = this.ops.clone(acc);
              this.ops.fold(a, v);
              view = { acc: a, count: count + 1 };
            } catch {
              /* partial line still being written */
            }
          }
          break;
        }
        // A line longer than the read: read again with a larger buffer.
        len = Math.min(size - offset, len * 2);
        grown = true;
        continue;
      }
      for (const line of buf.toString('utf8', 0, nl).split('\n')) {
        const s = line.trim();
        if (!s) continue;
        try {
          this.ops.fold(acc, JSON.parse(s));
          count++;
        } catch {
          /* malformed line, skipped as in jload */
        }
      }
      offset += nl + 1;
      budget.remaining -= nl + 1;
      budget.bytesRead += nl + 1;
      len = 0;
      grown = false;
      atEof = offset >= size;
    }
    this.committed = { acc, count };
    this.view = view ?? this.committed;
    this.complete = atEof;
    this.cursor = { dev: st.dev, ino: st.ino, size, mtimeMs: st.mtimeMs, offset };
  }
}

// --- Fold definitions for the two file kinds of a workflow run ---

// journal.jsonl: every record is kept (results are looked up by agent id).
export const JOURNAL_OPS: FoldOps<unknown[]> = {
  init: () => [],
  fold: (acc, v) => { acc.push(v); },
  clone: (acc) => acc.slice(),
};

// agent-<id>.jsonl: the running agentStats() plus the first user prompt, which
// is all buildSnapshot() needs from a transcript.
export interface TranscriptAcc {
  stats: AgentStats;
  // firstUserText() of the events so far; undefined until a user turn with text.
  prompt: string | undefined;
}

export const TRANSCRIPT_OPS: FoldOps<TranscriptAcc> = {
  init: () => ({ stats: newAgentStats(), prompt: undefined }),
  fold: (acc, v) => {
    foldAgentStats(acc.stats, v);
    if (acc.prompt === undefined) acc.prompt = userEventText(v);
  },
  clone: (acc) => ({ stats: cloneAgentStats(acc.stats), prompt: acc.prompt }),
};
