export const DEBOUNCE_MS = 30_000;
export const MAX_WAIT_MS = 120_000;

export type SchedulerClock<H = unknown> = {
  now(): number;
  setTimeout(fn: () => void, ms: number): H;
  clearTimeout(handle: H): void;
};

export type SyncScheduler = {
  notifyChange(): void;
  syncNow(): Promise<void>;
  cancel(): void;
  isRunning(): boolean;
};

const systemClock: SchedulerClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createSyncScheduler(opts: {
  run: () => Promise<void>;
  delayMs?: number;
  maxWaitMs?: number;
  clock?: SchedulerClock<any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- handle type is the clock's own
}): SyncScheduler {
  const delayMs = opts.delayMs ?? DEBOUNCE_MS;
  const maxWaitMs = opts.maxWaitMs ?? MAX_WAIT_MS;
  const clock = opts.clock ?? systemClock;

  let timer: unknown = null;
  let hasTimer = false;
  let firstPendingChange: number | null = null;
  let running = false;
  let queued = false;
  let waiters: Array<() => void> = [];

  function clearPending() {
    if (hasTimer) clock.clearTimeout(timer);
    timer = null;
    hasTimer = false;
    firstPendingChange = null;
  }

  // Any number of triggers while a run is in flight collapse into one follow-up.
  async function loop() {
    running = true;
    try {
      while (queued) {
        queued = false;
        clearPending();
        const batch = waiters;
        waiters = [];
        try {
          await opts.run();
        } catch {
          // Engines record their own errors; the scheduler must keep working.
        }
        for (const resolve of batch) resolve();
      }
    } finally {
      running = false;
    }
  }

  function trigger() {
    queued = true;
    if (!running) void loop();
  }

  return {
    notifyChange() {
      const now = clock.now();
      if (firstPendingChange === null) firstPendingChange = now;
      const fireAt = Math.min(now + delayMs, firstPendingChange + maxWaitMs);
      if (hasTimer) clock.clearTimeout(timer);
      hasTimer = true;
      timer = clock.setTimeout(() => {
        timer = null;
        hasTimer = false;
        trigger();
      }, Math.max(0, fireAt - now));
    },
    syncNow() {
      clearPending();
      const done = new Promise<void>((resolve) => waiters.push(resolve));
      trigger();
      return done;
    },
    cancel: clearPending,
    isRunning: () => running,
  };
}
