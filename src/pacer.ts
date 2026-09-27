// Paces snapshot rebuilds on the extension host thread, which every extension
// shares (Claude Code's own included). fs.watch fires on every transcript append,
// several times a second per live agent; rebuilding on each event froze and
// crashed the host during large workflow runs (issue #3).

// A burst of changes is picked up this long after its first event at the earliest...
export const WATCH_DEBOUNCE_MS = 250;
// ...and change-driven runs are at least this far apart.
export const WATCH_COALESCE_MS = 1000;

export class RefreshPacer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private due = 0;
  private rescanQueued = false;
  private lastRunAt = 0;

  // run(rescan) performs one refresh. Only this pacer calls it, so runs never
  // overlap or nest. rescan asks for the expensive parts (run discovery, repo walk).
  constructor(private readonly run: (rescan: boolean) => void) {}

  // Run in delayMs, unless a run is already queued to happen no later. A rescan
  // request is kept until the next run, whichever request queued it.
  request(delayMs: number, rescan: boolean): void {
    if (rescan) this.rescanQueued = true;
    const due = Date.now() + delayMs;
    if (this.timer !== null) {
      if (this.due <= due) return;
      clearTimeout(this.timer);
    }
    this.due = due;
    this.timer = setTimeout(() => this.fire(), delayMs);
  }

  // Something in the watched run changed.
  changed(): void {
    const wait = Math.max(WATCH_DEBOUNCE_MS, WATCH_COALESCE_MS - (Date.now() - this.lastRunAt));
    this.request(wait, false);
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.rescanQueued = false;
  }

  private fire(): void {
    this.timer = null;
    const rescan = this.rescanQueued;
    this.rescanQueued = false;
    this.lastRunAt = Date.now();
    this.run(rescan);
  }
}
