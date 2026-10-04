import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RefreshPacer, WATCH_DEBOUNCE_MS, WATCH_COALESCE_MS } from '../src/pacer';

// The pacer decides how often the extension host rebuilds the snapshot. A flood
// of file-change events must not turn into a flood of rebuilds (issue #3).

let runs: boolean[];
let pacer: RefreshPacer;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  runs = [];
  pacer = new RefreshPacer((rescan) => runs.push(rescan));
});

afterEach(() => {
  pacer.cancel();
  vi.useRealTimers();
});

describe('RefreshPacer.changed — coalescing file-change events', () => {
  it('a burst of events causes one run, WATCH_DEBOUNCE_MS after it started', () => {
    for (let i = 0; i < 100; i++) pacer.changed();
    vi.advanceTimersByTime(WATCH_DEBOUNCE_MS - 1);
    expect(runs).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(runs).toEqual([false]);
  });

  it('a continuous stream of events runs at most once per WATCH_COALESCE_MS', () => {
    // 50 events a second for 10 seconds.
    for (let t = 0; t < 10_000; t += 20) {
      pacer.changed();
      vi.advanceTimersByTime(20);
    }
    vi.advanceTimersByTime(WATCH_COALESCE_MS);
    expect(runs.length).toBeGreaterThanOrEqual(9);
    expect(runs.length).toBeLessThanOrEqual(11);
    expect(runs.every((r) => r === false)).toBe(true);
  });

  it('the first event after a quiet period is not held back for a full second', () => {
    pacer.changed();
    vi.advanceTimersByTime(WATCH_DEBOUNCE_MS);
    expect(runs).toHaveLength(1);
    vi.advanceTimersByTime(5_000);
    pacer.changed();
    vi.advanceTimersByTime(WATCH_DEBOUNCE_MS);
    expect(runs).toHaveLength(2);
  });
});

describe('RefreshPacer.request', () => {
  it('an earlier request replaces a later one', () => {
    pacer.changed(); // due in WATCH_DEBOUNCE_MS
    pacer.request(0, true);
    vi.advanceTimersByTime(0);
    expect(runs).toEqual([true]);
    vi.advanceTimersByTime(WATCH_COALESCE_MS);
    expect(runs).toEqual([true]);
  });

  it('a later request does not postpone an earlier one, and a queued rescan is kept', () => {
    pacer.request(0, false);
    pacer.request(500, true);
    vi.advanceTimersByTime(0);
    expect(runs).toEqual([true]);
  });

  it('the rescan flag is consumed by the run that honours it', () => {
    pacer.request(0, true);
    vi.advanceTimersByTime(0);
    pacer.request(0, false);
    vi.advanceTimersByTime(0);
    expect(runs).toEqual([true, false]);
  });

  it('a run may request the next one (continuation of a partial build)', () => {
    let left = 3;
    const p = new RefreshPacer((rescan) => {
      runs.push(rescan);
      if (--left > 0) p.request(0, false);
    });
    p.request(0, true);
    vi.runAllTimers();
    expect(runs).toEqual([true, false, false]);
  });

  it('cancel() drops the queued run and its rescan flag', () => {
    pacer.request(100, true);
    pacer.cancel();
    vi.advanceTimersByTime(1_000);
    expect(runs).toEqual([]);
    pacer.request(0, false);
    vi.advanceTimersByTime(0);
    expect(runs).toEqual([false]);
  });
});
