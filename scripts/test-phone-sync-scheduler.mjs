import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith(".") &&
      path.extname(specifier) === "" &&
      context.parentURL?.includes("/src/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { createSyncScheduler, DEBOUNCE_MS, MAX_WAIT_MS } = await import(
  pathToFileURL(path.join(process.cwd(), "src", "lib", "phone-sync", "scheduler.ts")).href
);

function fakeClock() {
  let t = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    pending: () => timers.size,
    // Advance to an absolute time, firing due timers in order.
    advanceTo(target) {
      for (;;) {
        let best = null;
        for (const [id, tm] of timers) {
          if (tm.at <= target && (!best || tm.at < best[1].at)) best = [id, tm];
        }
        if (!best) break;
        timers.delete(best[0]);
        t = best[1].at;
        best[1].fn();
      }
      t = target;
    },
  };
}

const flush = () => new Promise((r) => setImmediate(r));

// A controllable run: each call parks on a gate the test resolves by hand.
function makeRun() {
  const state = { calls: 0, gates: [], fail: false, instant: false };
  state.run = () => {
    state.calls++;
    if (state.fail) return Promise.reject(new Error("boom"));
    if (state.instant) return Promise.resolve();
    return new Promise((resolve) => state.gates.push(resolve));
  };
  return state;
}

test("constants", () => {
  assert.equal(DEBOUNCE_MS, 30_000);
  assert.equal(MAX_WAIT_MS, 120_000);
});

test("debounce: one change runs once at 30s", async () => {
  const clock = fakeClock();
  let calls = 0;
  const s = createSyncScheduler({ run: async () => void calls++, clock });
  s.notifyChange();
  clock.advanceTo(29_999);
  await flush();
  assert.equal(calls, 0);
  clock.advanceTo(30_000);
  await flush();
  assert.equal(calls, 1);
  clock.advanceTo(300_000);
  await flush();
  assert.equal(calls, 1);
});

test("restart: changes at 0 and 20s run once at 50s", async () => {
  const clock = fakeClock();
  let calls = 0;
  const s = createSyncScheduler({ run: async () => void calls++, clock });
  s.notifyChange();
  clock.advanceTo(20_000);
  s.notifyChange();
  clock.advanceTo(49_999);
  await flush();
  assert.equal(calls, 0);
  clock.advanceTo(50_000);
  await flush();
  assert.equal(calls, 1);
});

test("cap: changes every 10s still run at 120s", async () => {
  const clock = fakeClock();
  let calls = 0;
  const s = createSyncScheduler({ run: async () => void calls++, clock });
  for (let t = 0; t < 120_000; t += 10_000) {
    clock.advanceTo(t);
    s.notifyChange();
  }
  clock.advanceTo(119_999);
  await flush();
  assert.equal(calls, 0);
  clock.advanceTo(120_000);
  await flush();
  assert.equal(calls, 1);
});

test("syncNow runs immediately and cancels the pending timer", async () => {
  const clock = fakeClock();
  const r = makeRun();
  r.instant = true;
  const s = createSyncScheduler({ run: () => r.run(), clock });
  s.notifyChange();
  await s.syncNow();
  assert.equal(r.calls, 1);
  assert.equal(clock.pending(), 0);
  clock.advanceTo(200_000);
  await flush();
  assert.equal(r.calls, 1);
});

test("single flight: syncNow during a run resolves after one follow-up", async () => {
  const clock = fakeClock();
  const r = makeRun();
  const s = createSyncScheduler({ run: () => r.run(), clock });
  const first = s.syncNow();
  await flush();
  assert.equal(s.isRunning(), true);
  assert.equal(r.calls, 1);

  let secondDone = false;
  const second = s.syncNow().then(() => (secondDone = true));
  s.syncNow();
  s.syncNow();
  await flush();
  assert.equal(r.calls, 1);

  r.gates[0]();
  await first;
  await flush();
  assert.equal(r.calls, 2);
  assert.equal(secondDone, false);

  r.gates[1]();
  await second;
  await flush();
  assert.equal(r.calls, 2);
  assert.equal(s.isRunning(), false);
});

test("timer firing and syncNow during a run collapse to one follow-up", async () => {
  const clock = fakeClock();
  const r = makeRun();
  const s = createSyncScheduler({ run: () => r.run(), clock });
  const first = s.syncNow();
  await flush();
  s.notifyChange();
  clock.advanceTo(30_000);
  s.syncNow();
  s.syncNow();
  r.gates[0]();
  await first;
  await flush();
  assert.equal(r.calls, 2);
  r.gates[1]();
  await flush();
  assert.equal(r.calls, 2);
  assert.equal(s.isRunning(), false);
});

test("notifyChange during a run schedules a follow-up via debounce", async () => {
  const clock = fakeClock();
  const r = makeRun();
  const s = createSyncScheduler({ run: () => r.run(), clock });
  const first = s.syncNow();
  await flush();
  clock.advanceTo(5_000);
  s.notifyChange();
  r.gates[0]();
  await first;
  await flush();
  assert.equal(r.calls, 1);
  clock.advanceTo(34_999);
  await flush();
  assert.equal(r.calls, 1);
  clock.advanceTo(35_000);
  await flush();
  assert.equal(r.calls, 2);
});

test("cancel: a pending timer never fires", async () => {
  const clock = fakeClock();
  let calls = 0;
  const s = createSyncScheduler({ run: async () => void calls++, clock });
  s.notifyChange();
  s.cancel();
  clock.advanceTo(500_000);
  await flush();
  assert.equal(calls, 0);
  // cancel also resets the first-pending marker, so the cap restarts
  clock.advanceTo(600_000);
  s.notifyChange();
  clock.advanceTo(629_999);
  await flush();
  assert.equal(calls, 0);
  clock.advanceTo(630_000);
  await flush();
  assert.equal(calls, 1);
});

test("a rejecting run does not break the scheduler", async () => {
  const clock = fakeClock();
  const r = makeRun();
  r.fail = true;
  const s = createSyncScheduler({ run: () => r.run(), clock });
  await s.syncNow();
  assert.equal(r.calls, 1);
  assert.equal(s.isRunning(), false);
  r.fail = false;
  r.instant = true;
  await s.syncNow();
  assert.equal(r.calls, 2);
});

test("a queued follow-up still runs after a rejecting run", async () => {
  const clock = fakeClock();
  let calls = 0;
  let rejectFirst;
  const s = createSyncScheduler({
    run: () => {
      calls++;
      if (calls === 1) return new Promise((_, rej) => (rejectFirst = rej));
      return Promise.resolve();
    },
    clock,
  });
  const first = s.syncNow();
  await flush();
  const second = s.syncNow();
  rejectFirst(new Error("boom"));
  await first;
  await second;
  assert.equal(calls, 2);
});
