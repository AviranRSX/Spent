// End to end: the real PC phone-sync engine and the real phone sync engine
// share one folder that stands in for the Drive folder. The PC runs in a child
// process (scripts/phone-sync-e2e-pc.mjs) because both sides keep their
// database in globalThis._db; the phone runs here on sql.js. All data is
// synthetic.
//
// The scenarios share one PC, one folder and the same phones, and build on
// each other (device seqs, acks, the passphrase changed in 4). They must run
// in order, as a whole file; do not run one alone with --test-name-pattern.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createTempDataDir,
  registerSrcAliases,
  withFixedNow,
} from "./phone-sync-test-helpers.mjs";

registerSrcAliases();
const dataDir = createTempDataDir("spent-phone-e2e-");

const sqljsDb = await import("../src/mobile/db/sqljs-db.ts");
const { configureLocalWrites, reapplyOutbox } = await import("../src/mobile/local-writes.ts");
const { handleMobileRequest } = await import("../src/mobile/router.ts");
const { createLocalFiles } = await import("../src/mobile/storage/local-files.ts");
const { createEncryptedOutboxStore } = await import("../src/mobile/storage/outbox-store.ts");
const { inspectSnapshot } = await import("../src/mobile/sync/inspect-snapshot.ts");
const { createMobileSyncEngine } = await import("../src/mobile/sync/mobile-sync-engine.ts");
const { DriveError } = await import("../src/mobile/drive/drive-client.ts");
const { decryptPayload } = await import("../src/lib/phone-sync/crypto.ts");
const { SNAPSHOT_FILE, changeFileName } = await import("../src/lib/phone-sync/format.ts");

const PASS = "synthetic e2e passphrase";
const NEW_PASS = "a different synthetic passphrase";
// One clock for both sides of every screen comparison.
const NOW = new Date().toISOString();

const driveRoot = path.join(dataDir, "drive");
const folder = path.join(driveRoot, "Spent");
mkdirSync(folder, { recursive: true });

// ---------------------------------------------------------------- the PC

const driver = fileURLToPath(new URL("./phone-sync-e2e-pc.mjs", import.meta.url));
const child = fork(driver, [], {
  cwd: process.cwd(),
  env: { ...process.env },
  execArgv: ["--conditions", "react-server", "--experimental-transform-types", "--no-warnings"],
  stdio: ["ignore", "pipe", "pipe", "ipc"],
});
let pcDataDir = null;
let exited = null;
const childExit = new Promise((resolve) => child.once("exit", resolve));

/** Stops the PC (killing it if it does not exit), then removes both temp dirs. */
async function cleanup() {
  if (!exited) {
    await pc("stop").catch(() => undefined);
    if (child.connected) child.disconnect();
    const killer = setTimeout(() => child.kill(), 5_000);
    await childExit;
    clearTimeout(killer);
  }
  if (sqljsDb.isDatabaseLoaded()) sqljsDb.getDb().close();
  for (const dir of [pcDataDir, dataDir]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

// Registered before anything that can throw. A setup failure below runs
// cleanup itself, because the test runner's uncaught-error path exits without
// running test.after or "exit" listeners; the exit hook is a last resort so
// the child never outlives this process.
test.after(cleanup);
process.on("exit", () => {
  if (!exited) child.kill();
});

const pcLogs = [];
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => pcLogs.push(...chunk.split(/\r?\n/).filter(Boolean)));
}
const pending = new Map();
let nextCallId = 0;
// A PC call that takes this long means the driver is stuck: fail, don't hang.
const PC_CALL_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT = { timeout: 180_000 };

const ready = new Promise((resolve, reject) => {
  child.once("exit", (code, signal) => {
    exited = new Error(`PC driver exited (${code ?? signal}): ${pcLogs.join("\n")}`);
    reject(exited);
    // Fail every call still waiting on the dead child.
    for (const call of pending.values()) call.reject(exited);
    pending.clear();
  });
  child.on("message", (message) => {
    if (message.ready) {
      pcDataDir = message.dataDir;
      return resolve();
    }
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    if (message.ok) call.resolve(message.result);
    else call.reject(new Error(`PC ${call.command} failed: ${message.error}`));
  });
});

function pc(command, args) {
  if (exited) return Promise.reject(exited);
  nextCallId += 1;
  const id = nextCallId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`PC ${command} timed out after ${PC_CALL_TIMEOUT_MS} ms`));
    }, PC_CALL_TIMEOUT_MS);
    const settle = (fn) => (value) => {
      clearTimeout(timer);
      fn(value);
    };
    pending.set(id, { resolve: settle(resolve), reject: settle(reject), command });
    child.send({ id, command, args });
  });
}

/** PC log lines from phone sync (the driver prints nothing else on purpose). */
function takePcLogs() {
  const lines = pcLogs.filter((line) => line.startsWith("[phone-sync]"));
  pcLogs.length = 0;
  return lines;
}

let seeded;
try {
  await ready;
  seeded = await pc("init", { passphrase: PASS, folder });
  assert.ok(seeded.candidates.length >= 8, `enough editable rows: ${seeded.candidates.length}`);
} catch (error) {
  await cleanup();
  throw error;
}
const { workspaceId, categoryIds, candidates } = seeded;

// ---------------------------------------------------------------- the phones

/** Drive over a local folder. `offline` makes every call fail like a dead network. */
function folderDrive() {
  const state = { offline: false };
  const online = () => {
    if (state.offline) throw new DriveError("offline");
  };
  return {
    state,
    async findSpentFolders() {
      online();
      return [{ id: folder, name: path.basename(folder), ownerEmail: "someone@example.com" }];
    },
    async getFileMeta(folderId, name) {
      online();
      if (!existsSync(folderId)) throw new DriveError("folder_unavailable");
      const file = path.join(folderId, name);
      if (!existsSync(file)) return null;
      const bytes = readFileSync(file);
      return {
        id: file,
        modifiedTime: statSync(file).mtime.toISOString(),
        md5Checksum: createHash("md5").update(bytes).digest("hex"),
        size: bytes.length,
      };
    },
    async download(fileId) {
      online();
      return new Uint8Array(readFileSync(fileId));
    },
    async upsertFile(folderId, name, bytes) {
      online();
      writeFileSync(path.join(folderId, name), bytes);
    },
  };
}

/** The Capacitor Filesystem plugin, in memory. */
function memoryFs() {
  const files = new Map();
  const missing = (p) =>
    Object.assign(new Error(`File does not exist: ${p}`), { code: "OS-PLUG-FILE-0008" });
  return {
    async stat({ path: p }) {
      if (!files.has(p)) throw missing(p);
      return { type: "file", size: files.get(p).length };
    },
    async readFile({ path: p }) {
      if (!files.has(p)) throw missing(p);
      return { data: files.get(p) };
    },
    async writeFile({ path: p, data }) {
      files.set(p, data);
      return { uri: p };
    },
    async deleteFile({ path: p }) {
      if (!files.has(p)) throw missing(p);
      files.delete(p);
    },
    async rename({ from, to }) {
      if (!files.has(from)) throw missing(from);
      files.set(to, files.get(from));
      files.delete(from);
    },
  };
}

// Timers never fire: every sync in this test is an explicit sync() call.
const frozenClock = { now: () => 0, setTimeout: () => 0, clearTimeout: () => undefined };

// Phones share the one sql.js database slot and the local-writes module, as
// only one app runs per device. `use` switches by booting the other phone
// from its own local snapshot, which is what reopening the app does.
let active = null;

function createPhone(name, deviceId) {
  const fs = memoryFs();
  const files = createLocalFiles(async () => ({ fs, directory: "DATA" }));
  const secrets = new Map();
  const drive = folderDrive();
  const workspace = { value: workspaceId };
  let engine = null;
  const outbox = createEncryptedOutboxStore({
    files,
    getPassphrase: () => engine?.getPassphrase() ?? null,
  });
  engine = createMobileSyncEngine({
    drive,
    files,
    secrets: {
      get: async (key) => secrets.get(key) ?? null,
      set: async (key, value) => void secrets.set(key, value),
      clearAll: async () => secrets.clear(),
    },
    outbox,
    loadDatabase: sqljsDb.loadDatabase,
    inspectSnapshot,
    reapplyOutbox,
    invalidateAll: () => undefined,
    now: () => new Date(),
    setLocale: () => undefined,
    workspace: { get: () => workspace.value, set: (id) => void (workspace.value = id) },
    signOut: async () => undefined,
    clock: frozenClock,
    randomId: () => deviceId,
  });
  const phone = {
    name,
    deviceId,
    engine,
    drive,
    outbox,
    configure() {
      configureLocalWrites({
        outbox,
        getAck: () => engine.getAck(),
        onChange: () => engine.notifyChange(),
      });
      active = phone;
    },
    async onboard() {
      phone.configure();
      const folders = await engine.listFolders();
      assert.equal(folders.length, 1);
      assert.equal(await engine.prepareConnection(folders[0], PASS), "ok");
      assert.equal(await engine.completeConnection(name), "ready");
      await engine.sync();
    },
    async use() {
      if (active === phone) return;
      phone.configure();
      assert.equal(await engine.boot(), "ready");
      await engine.sync();
    },
    async request(url, init = {}) {
      assert.equal(active, phone, `${name} is the open app`);
      const res = await handleMobileRequest(url, {
        ...init,
        headers: { "x-workspace-id": String(workspace.value) },
      });
      return { status: res.status, body: await res.json() };
    },
    async recategorize(id, categoryId) {
      const res = await phone.request(`/api/transactions/${id}`, {
        method: "PUT",
        body: JSON.stringify({ categoryId }),
      });
      assert.deepEqual(res, { status: 200, body: { success: true } });
      // notifyChange refreshes the count without awaiting it.
      await new Promise((resolve) => setImmediate(resolve));
    },
    row(id) {
      return sqljsDb
        .getDb()
        .prepare("SELECT category_id, category_source FROM transactions WHERE id = ?")
        .get(id);
    },
  };
  return phone;
}

async function snapshotAcks(passphrase = PASS) {
  const blob = new Uint8Array(readFileSync(path.join(folder, SNAPSHOT_FILE)));
  return (await inspectSnapshot(await decryptPayload(blob, passphrase))).acks;
}

function device(status, deviceId) {
  return status.devices.find((d) => d.deviceId === deviceId);
}

/** Two categories that differ from the row's current one and from each other. */
async function targetsFor(id) {
  const { category_id: current } = await pc("row", { id });
  return ["Groceries", "Restaurants", "Shopping", "Entertainment", "Health"]
    .map((name) => categoryIds[name])
    .filter((cid) => cid != null && cid !== current);
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(key) {
  const [y, m] = key.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, "0")}` };
}

const thisMonth = monthKey(new Date(NOW));
const lastMonth = monthKey(new Date(new Date(NOW).getFullYear(), new Date(NOW).getMonth() - 1, 1));

/** Every compared screen request, PC handler vs phone router, same clock. */
async function assertScreensMatch(phone) {
  for (const month of [thisMonth, lastMonth]) {
    const { from, to } = monthRange(month);
    const requests = [
      ["/api/home", `month=${month}`],
      ["/api/transactions/summary", `from=${from}&to=${to}`],
      ["/api/summary", `from=${from}&to=${to}`],
      ["/api/summary", `from=${from}&to=${to}&sourceType=card`],
    ];
    for (const [route, query] of requests) {
      const desktop = await pc("handler", { path: route, query, now: NOW });
      const mobile = await withFixedNow(NOW, () => phone.request(`${route}?${query}`));
      assert.equal(desktop.status, 200, `${route}?${query} on the PC`);
      assert.equal(mobile.status, 200, `${route}?${query} on the phone`);
      assert.deepEqual(mobile.body, desktop.body, `${route}?${query}`);
    }
  }
}

const phoneA = createPhone("Phone A", "a".repeat(32));
const phoneB = createPhone("Phone B", "b".repeat(32));

// ---------------------------------------------------------------- scenarios

test("1. PC snapshot loads on the phone and the numbers match", TEST_TIMEOUT, async () => {
  const status = await pc("sync");
  assert.equal(status.error, null);
  assert.ok(existsSync(path.join(folder, SNAPSHOT_FILE)));

  await phoneA.onboard();
  assert.equal(phoneA.engine.getState().error, null);
  assert.equal(phoneA.engine.hasData(), true);

  // Not vacuous: the month has spending on both sides.
  const home = await withFixedNow(NOW, () => phoneA.request(`/api/home?month=${thisMonth}`));
  assert.deepEqual(home.body.errors, []);
  assert.ok(home.body.kpis, "home KPIs present");
  const summary = await phoneA.request(
    `/api/transactions/summary?from=${monthRange(thisMonth).from}&to=${monthRange(thisMonth).to}`
  );
  assert.ok(JSON.stringify(summary.body) !== "{}", "transactions summary present");

  await assertScreensMatch(phoneA);
  assert.deepEqual(takePcLogs(), []);
});

test("2. offline edits reach the PC, are acked, and leave the outbox", TEST_TIMEOUT, async () => {
  const [t1, t2] = candidates;
  const [c1] = await targetsFor(t1);
  const [c2] = await targetsFor(t2);

  phoneA.drive.state.offline = true;
  await phoneA.recategorize(t1, c1);
  await phoneA.recategorize(t2, c2);
  await phoneA.engine.sync();
  let state = phoneA.engine.getState();
  assert.equal(state.error, "offline");
  assert.equal(state.pendingCount, 2);
  assert.equal(phoneA.row(t1).category_id, c1, "edit shown while offline");
  assert.equal(existsSync(path.join(folder, changeFileName(phoneA.deviceId))), false);

  phoneA.drive.state.offline = false;
  await phoneA.engine.sync();
  state = phoneA.engine.getState();
  assert.equal(state.error, null);
  assert.equal(state.pendingCount, 2, "not acked yet");
  assert.ok(existsSync(path.join(folder, changeFileName(phoneA.deviceId))));

  const status = await pc("sync");
  assert.equal(status.error, null);
  const a = device(status, phoneA.deviceId);
  assert.equal(a.deviceName, "Phone A");
  assert.equal(a.appliedCount, 2);
  assert.equal(a.lastAppliedSeq, 2);
  assert.equal(a.lastError, null);
  for (const [id, cid] of [
    [t1, c1],
    [t2, c2],
  ]) {
    const row = await pc("row", { id });
    assert.equal(row.category_id, cid);
    assert.equal(row.category_source, "user");
    assert.equal(row.needs_review, 0);
    assert.ok(row.category_decided_at);
    assert.deepEqual(await pc("merchant", { description: row.description }), {
      category_id: cid,
      source: "user",
    });
  }
  assert.deepEqual(await snapshotAcks(), { [phoneA.deviceId]: 2 });

  await phoneA.engine.sync();
  state = phoneA.engine.getState();
  assert.equal(state.error, null);
  assert.equal(state.pendingCount, 0);
  assert.equal(phoneA.engine.getAck(), 2);
  assert.deepEqual(await phoneA.outbox.load(), []);
  assert.deepEqual(phoneA.row(t1), { category_id: c1, category_source: "user" });
  assert.deepEqual(phoneA.row(t2), { category_id: c2, category_source: "user" });

  await assertScreensMatch(phoneA);
  assert.deepEqual(takePcLogs(), []);
});

test("3. two phones: both edits applied, each acked on its own", TEST_TIMEOUT, async () => {
  const tA = candidates[2];
  const tB = candidates[3];
  const [cA] = await targetsFor(tA);
  const [cB] = await targetsFor(tB);

  await phoneB.onboard();
  assert.equal(phoneB.engine.getState().error, null);
  await phoneB.recategorize(tB, cB);
  await phoneB.engine.sync();

  await phoneA.use();
  await phoneA.recategorize(tA, cA);
  await phoneA.engine.sync();

  const status = await pc("sync");
  assert.equal(status.error, null);
  assert.equal(device(status, phoneA.deviceId).appliedCount, 3);
  assert.equal(device(status, phoneB.deviceId).appliedCount, 1);
  assert.equal(device(status, phoneB.deviceId).deviceName, "Phone B");
  assert.equal((await pc("row", { id: tA })).category_id, cA);
  assert.equal((await pc("row", { id: tB })).category_id, cB);
  assert.deepEqual(await snapshotAcks(), { [phoneA.deviceId]: 3, [phoneB.deviceId]: 1 });

  await phoneA.engine.sync();
  assert.equal(phoneA.engine.getAck(), 3);
  assert.equal(phoneA.engine.getState().pendingCount, 0);
  assert.equal(phoneA.row(tB).category_id, cB, "A sees B's edit");

  await phoneB.use();
  assert.equal(phoneB.engine.getAck(), 1);
  assert.equal(phoneB.engine.getState().pendingCount, 0);
  assert.equal(phoneB.row(tA).category_id, cA, "B sees A's edit");
  assert.deepEqual(takePcLogs(), []);
});

test("4. passphrase changed on the PC keeps the pending edit", TEST_TIMEOUT, async () => {
  await phoneA.use();
  const t = candidates[4];
  const [c] = await targetsFor(t);
  const before = (await pc("row", { id: t })).category_id;

  phoneA.drive.state.offline = true;
  await phoneA.recategorize(t, c);
  assert.equal(phoneA.engine.getState().pendingCount, 1);

  await pc("setPassphrase", { passphrase: NEW_PASS });
  assert.equal((await pc("sync")).error, null);
  await assert.doesNotReject(snapshotAcks(NEW_PASS));

  phoneA.drive.state.offline = false;
  await phoneA.engine.sync();
  let state = phoneA.engine.getState();
  assert.equal(state.error, "bad_passphrase");
  assert.equal(state.pendingCount, 1);
  assert.equal((await phoneA.outbox.load()).length, 1);
  assert.equal(phoneA.row(t).category_id, c, "edit still shown");

  // The upload made under the old passphrase can't be read on the PC.
  let status = await pc("sync");
  assert.equal(status.error, null);
  assert.equal(device(status, phoneA.deviceId).lastError, "bad_passphrase");
  assert.equal((await pc("row", { id: t })).category_id, before);
  assert.deepEqual(takePcLogs(), [
    `[phone-sync] change file for device ${phoneA.deviceId} failed: bad_passphrase`,
  ]);

  assert.equal(await phoneA.engine.submitPassphrase(NEW_PASS), "ok");
  state = phoneA.engine.getState();
  assert.equal(state.error, null);
  assert.equal(state.pendingCount, 1);

  status = await pc("sync");
  const a = device(status, phoneA.deviceId);
  assert.equal(a.lastError, null);
  assert.equal(a.appliedCount, 4);
  assert.equal((await pc("row", { id: t })).category_id, c);
  assert.equal((await snapshotAcks(NEW_PASS))[phoneA.deviceId], 4);

  await phoneA.engine.sync();
  assert.equal(phoneA.engine.getState().pendingCount, 0);
  assert.equal(phoneA.engine.getState().error, null);
  assert.deepEqual(takePcLogs(), []);
});

test("5. PC folder unavailable: status error, nothing written, recovers", TEST_TIMEOUT, async () => {
  const away = `${folder}-away`;
  const t = candidates[5];
  const [c] = await targetsFor(t);
  const listing = (dir) =>
    readdirSync(dir)
      .sort()
      .map((name) => [name, statSync(path.join(dir, name)).mtimeMs, statSync(path.join(dir, name)).size]);
  const lastSnapshotAt = (await pc("status")).lastSnapshotAt;

  renameSync(folder, away);
  try {
    const rootBefore = readdirSync(driveRoot).sort();
    const awayBefore = listing(away);
    // A desktop edit while the folder is gone stays pending for later.
    assert.equal((await pc("recategorize", { id: t, categoryId: c })).status, 200);
    const status = await pc("sync");
    assert.equal(status.state, "error");
    assert.equal(status.error, "folder_unavailable");
    assert.equal(status.lastSnapshotAt, lastSnapshotAt);
    assert.equal(existsSync(folder), false, "the folder was not recreated");
    assert.deepEqual(readdirSync(driveRoot).sort(), rootBefore);
    assert.deepEqual(listing(away), awayBefore);
    assert.equal((await pc("status")).error, "folder_unavailable");
  } finally {
    renameSync(away, folder);
  }

  const status = await pc("sync");
  assert.equal(status.state, "idle");
  assert.equal(status.error, null);
  assert.notEqual(status.lastSnapshotAt, lastSnapshotAt, "the pending edit wrote a snapshot");

  await phoneA.engine.sync();
  assert.equal(phoneA.engine.getState().error, null);
  assert.deepEqual(phoneA.row(t), { category_id: c, category_source: "user" });
  assert.deepEqual(takePcLogs(), []);
});

test("6. conflict: a later PC decision wins over the phone edit", TEST_TIMEOUT, async () => {
  const t = candidates[6];
  const [phoneChoice, pcChoice] = await targetsFor(t);

  phoneA.drive.state.offline = true;
  await phoneA.recategorize(t, phoneChoice);
  assert.equal(phoneA.engine.getState().pendingCount, 1);
  // The PC decision must be strictly later than the phone's edit time. Both
  // are new Date().toISOString() (ms precision) on one machine clock, so a
  // 5 ms gap makes the PC string compare greater.
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await pc("recategorize", { id: t, categoryId: pcChoice })).status, 200);
  const decidedOnPc = (await pc("row", { id: t })).category_decided_at;
  // The PC publishes its decision before it has seen the phone's edit.
  assert.equal((await pc("sync")).error, null);

  phoneA.drive.state.offline = false;
  await phoneA.engine.sync();
  assert.equal(phoneA.engine.getState().error, null);
  // Replaying the unacked edit over that snapshot keeps the newer PC decision,
  // and the edit stays pending until the PC skips and acks it.
  assert.equal(phoneA.row(t).category_id, pcChoice);
  assert.equal(phoneA.engine.getState().pendingCount, 1);

  const before = device(await pc("status"), phoneA.deviceId);
  const status = await pc("sync");
  const a = device(status, phoneA.deviceId);
  assert.equal(a.skippedNewerCount, before.skippedNewerCount + 1);
  assert.equal(a.appliedCount, before.appliedCount);
  assert.equal(a.lastAppliedSeq, 5);
  const row = await pc("row", { id: t });
  assert.equal(row.category_id, pcChoice);
  assert.equal(row.category_decided_at, decidedOnPc);
  assert.equal((await snapshotAcks(NEW_PASS))[phoneA.deviceId], 5);

  await phoneA.engine.sync();
  assert.equal(phoneA.engine.getState().pendingCount, 0);
  assert.deepEqual(phoneA.row(t), { category_id: pcChoice, category_source: "user" });

  await assertScreensMatch(phoneA);
  assert.deepEqual(takePcLogs(), []);
});

test("7. approve of a category the AI changed since is skipped as a mismatch", TEST_TIMEOUT, async () => {
  const t = candidates[7];
  const [seen, later] = await targetsFor(t);
  await pc("aiCategorize", { id: t, categoryId: seen });
  assert.equal((await pc("sync")).error, null);
  await phoneA.engine.sync();
  assert.equal(phoneA.row(t).category_id, seen);

  phoneA.drive.state.offline = true;
  const res = await phoneA.request(`/api/transactions/${t}`, {
    method: "PATCH",
    body: JSON.stringify({ approve: true }),
  });
  assert.deepEqual(res, { status: 200, body: { success: true } });
  const [entry] = await phoneA.outbox.load();
  assert.equal(entry.action, "approve");
  assert.equal(entry.categoryId, seen);

  // An AI pass on the PC changes the category before the approve arrives.
  await pc("aiCategorize", { id: t, categoryId: later });
  assert.equal((await pc("sync")).error, null);
  phoneA.drive.state.offline = false;
  await phoneA.engine.sync();
  assert.equal(phoneA.engine.getState().error, null);
  assert.equal(phoneA.row(t).category_id, later, "replay does not approve the new category");

  const before = device(await pc("status"), phoneA.deviceId);
  const a = device(await pc("sync"), phoneA.deviceId);
  assert.equal(a.skippedMismatchCount, before.skippedMismatchCount + 1);
  assert.equal(a.appliedCount, before.appliedCount);
  assert.equal(a.lastAppliedSeq, entry.seq);
  const row = await pc("row", { id: t });
  assert.equal(row.category_id, later);
  assert.equal(row.category_source, "ai");
  assert.equal(row.needs_review, 1, "still needs review");
  assert.equal(row.category_decided_at, null);

  await phoneA.engine.sync();
  assert.equal(phoneA.engine.getState().pendingCount, 0);
  assert.equal(phoneA.row(t).category_id, later);
  assert.deepEqual(takePcLogs(), []);
});
