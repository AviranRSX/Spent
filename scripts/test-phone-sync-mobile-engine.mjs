import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createTempDataDir,
  registerSrcAliases,
  seedSyntheticWorkspace,
} from "./phone-sync-test-helpers.mjs";

registerSrcAliases();
const dataDir = createTempDataDir("spent-phone-engine-");

const { getDb } = await import("../src/server/db/index.ts");
const native = getDb();
const { workspaceId, categoryIds, transactionIds } = await seedSyntheticWorkspace(native);
const baseFile = path.join(dataDir, "snapshot.db");
native.exec(`VACUUM INTO '${baseFile.replaceAll("'", "''")}'`);
const baseBytes = new Uint8Array(readFileSync(baseFile));

const sqljsDb = await import("../src/mobile/db/sqljs-db.ts");
const { createSqlJsDatabase } = await import("../src/mobile/db/sqljs-adapter.ts");
const { reapplyOutbox } = await import("../src/mobile/local-writes.ts");
const { createLocalFiles } = await import("../src/mobile/storage/local-files.ts");
const { createEncryptedOutboxStore } = await import("../src/mobile/storage/outbox-store.ts");
const { inspectSnapshot } = await import("../src/mobile/sync/inspect-snapshot.ts");
const { createMobileSyncEngine } = await import("../src/mobile/sync/mobile-sync-engine.ts");
const { DriveError } = await import("../src/mobile/drive/drive-client.ts");
const { encryptPayload, decryptPayload } = await import("../src/lib/phone-sync/crypto.ts");
const { decodeChangeFile } = await import("../src/lib/phone-sync/changes.ts");
const { SNAPSHOT_FILE, changeFileName } = await import("../src/lib/phone-sync/format.ts");

test.after(() => {
  native.close();
  if (sqljsDb.isDatabaseLoaded()) sqljsDb.getDb().close();
  rmSync(dataDir, { recursive: true, force: true });
});

const PASS = "correct horse battery staple";
const NEW_PASS = "a brand new passphrase for the pc";
const DEVICE_ID = "device0aaaa1111";
const FOLDER = { id: "folder-1", name: "Spent", ownerEmail: "someone@example.com" };
const txId = transactionIds[0];
const NOW = new Date("2026-10-16T09:00:00.000Z");

/** Snapshot bytes: the seeded DB plus phone_sync_meta acks, then `mutate`. */
async function snapshotBytes({ acks = {}, mutate } = {}) {
  const db = await createSqlJsDatabase(baseBytes);
  db.exec("CREATE TABLE phone_sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.prepare("INSERT INTO phone_sync_meta (key, value) VALUES ('acks', ?)").run(
    JSON.stringify(acks)
  );
  mutate?.(db);
  const bytes = db.export();
  db.close();
  return bytes;
}

const encoder = new TextEncoder();

function change(seq, categoryId) {
  return {
    seq,
    workspaceId,
    transactionId: txId,
    dedupHash: "hash-not-checked-here",
    action: "setCategory",
    categoryId,
    at: new Date(Date.UTC(2026, 9, 16, 8, 0, seq)).toISOString(),
  };
}

function fakeFs() {
  const files = new Map();
  const missing = (p) => Object.assign(new Error(`File does not exist: ${p}`), { code: "OS-PLUG-FILE-0008" });
  return {
    files,
    fs: {
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
    },
  };
}

/** A promise plus its resolver, and a flag for "something is waiting on it". */
function gate() {
  let open;
  const promise = new Promise((resolve) => {
    open = resolve;
  });
  const g = { promise, open, reached: false };
  g.wait = async () => {
    g.reached = true;
    await promise;
  };
  return g;
}

async function until(condition, label) {
  for (let i = 0; i < 2000; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function fakeSecrets(initial = {}) {
  const map = new Map(Object.entries(initial));
  const holds = new Map();
  return {
    map,
    holds,
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      const hold = holds.get(key);
      if (hold) {
        holds.delete(key);
        await hold.wait();
      }
      map.set(key, value);
    },
    async clearAll() {
      map.clear();
    },
  };
}

function fakeDrive() {
  const calls = [];
  const uploads = [];
  // holdUpload / holdDownload: a gate() the next call waits on (used once).
  const state = { remote: null, md5: "md5-1", fail: null, holdUpload: null, holdDownload: null };
  return {
    calls,
    uploads,
    state,
    async findSpentFolders() {
      calls.push("findSpentFolders");
      if (state.fail) throw new DriveError(state.fail);
      return [FOLDER];
    },
    async getFileMeta(folderId, name) {
      calls.push(`getFileMeta:${name}`);
      if (state.fail) throw new DriveError(state.fail);
      if (name !== SNAPSHOT_FILE || !state.remote) return null;
      return { id: "snapshot-id", modifiedTime: NOW.toISOString(), md5Checksum: state.md5, size: state.remote.length };
    },
    async download(fileId) {
      calls.push(`download:${fileId}`);
      if (state.fail) throw new DriveError(state.fail);
      const hold = state.holdDownload;
      if (hold) {
        state.holdDownload = null;
        await hold.wait();
      }
      return state.remote;
    },
    async upsertFile(folderId, name, bytes) {
      calls.push(`upsertFile:${name}`);
      if (state.fail) throw new DriveError(state.fail);
      const hold = state.holdUpload;
      if (hold) {
        state.holdUpload = null;
        await hold.wait();
      }
      uploads.push({ folderId, name, bytes });
    },
  };
}

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * An engine with fakes. `connected` stores the secrets and a local snapshot
 * (encrypted with PASS) as a finished onboarding would.
 */
async function harness({
  connected = true,
  outbox = [],
  local,
  remote,
  remotePassphrase = PASS,
  storedMd5,
  activeWorkspace = workspaceId,
  loadDatabase,
} = {}) {
  const disk = fakeFs();
  const files = createLocalFiles(async () => ({ fs: disk.fs, directory: "DATA" }));
  const secrets = fakeSecrets(
    connected
      ? {
          passphrase: PASS,
          deviceId: DEVICE_ID,
          deviceName: "Phone",
          folderId: FOLDER.id,
          folderName: FOLDER.name,
          ...(storedMd5 ? { snapshotMd5: storedMd5 } : {}),
        }
      : {}
  );
  // Like mobile-root.tsx: the store encrypts with the engine's session
  // passphrase (PASS only while seeding, before the engine exists).
  let engineRef = null;
  const store = createEncryptedOutboxStore({
    files,
    getPassphrase: () => (engineRef ? engineRef.getPassphrase() : PASS),
  });
  if (connected) {
    await files.writeSnapshotBlob(await encryptPayload(local ?? (await snapshotBytes()), PASS));
    if (outbox.length) await store.save(outbox);
    store.reset();
  }
  const drive = fakeDrive();
  drive.state.remote = await encryptPayload(remote ?? (await snapshotBytes()), remotePassphrase);
  const clock = fakeClock();
  const workspace = { value: activeWorkspace, sets: [] };
  const events = { invalidations: 0, locales: [], signOuts: 0 };
  const engine = createMobileSyncEngine({
    drive,
    files,
    secrets,
    outbox: store,
    loadDatabase: loadDatabase ?? sqljsDb.loadDatabase,
    inspectSnapshot,
    reapplyOutbox,
    invalidateAll: () => {
      events.invalidations += 1;
    },
    now: () => NOW,
    setLocale: (locale) => events.locales.push(locale),
    workspace: {
      get: () => workspace.value,
      set: (id) => {
        workspace.value = id;
        workspace.sets.push(id);
      },
    },
    signOut: async () => {
      events.signOuts += 1;
    },
    clock,
    randomId: () => "0123456789abcdef0123456789abcdef",
  });
  engineRef = engine;
  return { engine, drive, files, disk, secrets, store, clock, workspace, events };
}

function categoryOf(id) {
  return sqljsDb.getDb().prepare("SELECT category_id AS c FROM transactions WHERE id = ?").get(id).c;
}

function workspaceNames() {
  return sqljsDb.getDb().prepare("SELECT name FROM workspaces ORDER BY id").all().map((r) => r.name);
}

test("first boot needs onboarding", async () => {
  const h = await harness({ connected: false });
  assert.equal(await h.engine.boot(), "needs_onboarding");
  assert.deepEqual(h.drive.calls, []);
  assert.equal(h.engine.getState().state, "idle");
});

test("sync uploads outbox before downloading", async () => {
  const h = await harness({ outbox: [change(1, categoryIds.Restaurants)] });
  assert.equal(await h.engine.boot(), "ready");
  await h.engine.sync();

  const upload = h.drive.calls.indexOf(`upsertFile:${changeFileName(DEVICE_ID)}`);
  const meta = h.drive.calls.indexOf(`getFileMeta:${SNAPSHOT_FILE}`);
  assert.ok(upload >= 0, "uploads the change file");
  assert.ok(upload < meta, `upload comes first: ${h.drive.calls.join(", ")}`);

  const file = decodeChangeFile(await decryptPayload(h.drive.uploads[0].bytes, PASS));
  assert.equal(file.deviceId, DEVICE_ID);
  assert.equal(file.deviceName, "Phone");
  assert.deepEqual(file.changes.map((c) => c.seq), [1]);

  const state = h.engine.getState();
  assert.equal(state.error, null);
  assert.equal(state.state, "idle");
  assert.equal(state.lastSyncedAt, NOW.toISOString());
  assert.equal(h.secrets.map.get("snapshotMd5"), "md5-1");
  assert.ok(h.events.invalidations > 0);
});

test("empty outbox uploads nothing", async () => {
  const h = await harness();
  await h.engine.boot();
  await h.engine.sync();
  assert.equal(h.drive.uploads.length, 0);
});

test("unchanged checksum skips download", async () => {
  const h = await harness({ storedMd5: "md5-1" });
  assert.equal(await h.engine.boot(), "ready");
  await h.engine.sync();
  assert.ok(h.drive.calls.includes(`getFileMeta:${SNAPSHOT_FILE}`));
  assert.ok(!h.drive.calls.some((c) => c.startsWith("download")), h.drive.calls.join(", "));
  assert.equal(h.engine.getState().error, null);
  assert.equal(h.engine.getState().lastSyncedAt, NOW.toISOString());
});

test("acks prune outbox", async () => {
  const outbox = [
    change(1, categoryIds.Restaurants),
    change(2, categoryIds.Groceries),
    change(3, categoryIds.Transfers),
  ];
  const remote = await snapshotBytes({ acks: { [DEVICE_ID]: 2 } });
  const h = await harness({ outbox, remote });
  await h.engine.boot();
  await h.engine.sync();

  assert.deepEqual((await h.store.load()).map((c) => c.seq), [3]);
  h.store.reset();
  assert.deepEqual((await h.store.load()).map((c) => c.seq), [3], "saved to disk");
  assert.equal(categoryOf(txId), categoryIds.Transfers);
  assert.equal(h.engine.getState().pendingCount, 1);
});

test("corrupt snapshot keeps local data", async () => {
  const outbox = [change(1, categoryIds.Restaurants)];
  const h = await harness({ outbox, storedMd5: "md5-0" });
  await h.engine.boot();
  await h.engine.sync();
  const dbBefore = sqljsDb.getDb();
  const blobBefore = h.disk.files.get("snapshot.spent.enc");
  const outboxBefore = h.disk.files.get("outbox.bin");

  h.drive.state.remote = encoder.encode("SPNX this is not a snapshot file at all, just bytes");
  h.drive.state.md5 = "md5-2";
  await h.engine.sync();

  const state = h.engine.getState();
  assert.equal(state.error, "bad_format");
  assert.equal(state.state, "error");
  assert.equal(sqljsDb.getDb(), dbBefore, "the loaded DB was not replaced");
  assert.equal(categoryOf(txId), categoryIds.Restaurants);
  assert.equal(h.disk.files.get("snapshot.spent.enc"), blobBefore);
  assert.equal(h.disk.files.get("outbox.bin"), outboxBefore);
  assert.equal(state.pendingCount, 1);
});

test("passphrase changed on PC", async () => {
  const outbox = [change(1, categoryIds.Restaurants)];
  const remote = await snapshotBytes({
    mutate: (db) => db.prepare("UPDATE workspaces SET name = 'Renamed On PC' WHERE id = ?").run(workspaceId),
  });
  const h = await harness({ outbox, remote, remotePassphrase: NEW_PASS });
  assert.equal(await h.engine.boot(), "ready", "the old local snapshot still opens");
  await h.engine.sync();

  assert.equal(h.engine.getState().error, "bad_passphrase");
  assert.ok(!workspaceNames().includes("Renamed On PC"));
  assert.deepEqual((await h.store.load()).map((c) => c.seq), [1]);
  assert.equal(h.engine.getState().pendingCount, 1);

  assert.equal(await h.engine.submitPassphrase("not the passphrase at all"), "bad_passphrase");
  assert.equal(h.secrets.map.get("passphrase"), PASS);

  assert.equal(await h.engine.submitPassphrase(NEW_PASS), "ok");
  assert.equal(h.secrets.map.get("passphrase"), NEW_PASS);
  // The outbox on disk is now encrypted with the new passphrase and kept its entry.
  h.store.reset();
  assert.deepEqual((await h.store.load()).map((c) => c.seq), [1]);
  const lastUpload = h.drive.uploads.at(-1);
  const file = decodeChangeFile(await decryptPayload(lastUpload.bytes, NEW_PASS));
  assert.deepEqual(file.changes.map((c) => c.seq), [1]);
  // The new snapshot is loaded and the pending edit re-applied on top.
  assert.ok(workspaceNames().includes("Renamed On PC"));
  assert.equal(categoryOf(txId), categoryIds.Restaurants);
  const state = h.engine.getState();
  assert.equal(state.error, null);
  assert.equal(state.pendingCount, 1);
  await assert.doesNotReject(decryptPayload(await h.files.readSnapshotBlob(), NEW_PASS));
});

test("local snapshot under an unknown passphrase needs the passphrase", async () => {
  const h = await harness();
  await h.files.writeSnapshotBlob(await encryptPayload(await snapshotBytes(), NEW_PASS));
  assert.equal(await h.engine.boot(), "needs_passphrase");
});

test("newer schema", async () => {
  const remote = await snapshotBytes({
    mutate: (db) => {
      db.prepare("INSERT INTO _migrations (name) VALUES ('099_future.sql')").run();
      db.prepare("UPDATE workspaces SET name = 'From The Future' WHERE id = ?").run(workspaceId);
    },
  });
  const h = await harness({ remote });
  await h.engine.boot();
  const blobBefore = h.disk.files.get("snapshot.spent.enc");
  await h.engine.sync();

  assert.equal(h.engine.getState().error, "update_phone_app");
  assert.ok(!workspaceNames().includes("From The Future"), "old DB kept");
  assert.equal(h.disk.files.get("snapshot.spent.enc"), blobBefore);
});

test("older schema than the minimum asks to update the PC", async () => {
  const remote = await snapshotBytes({
    mutate: (db) => db.exec("DELETE FROM _migrations WHERE name >= '020'"),
  });
  const h = await harness({ remote });
  await h.engine.boot();
  await h.engine.sync();
  assert.equal(h.engine.getState().error, "update_pc");
});

test("active workspace removed", async () => {
  const h = await harness({ activeWorkspace: 99 });
  assert.equal(await h.engine.boot(), "ready");
  const lowest = sqljsDb.getDb().prepare("SELECT MIN(id) AS id FROM workspaces").get().id;
  assert.equal(h.workspace.value, lowest);
  await h.engine.sync();
  assert.equal(h.workspace.value, lowest);
});

test("language comes from the snapshot settings", async () => {
  const local = await snapshotBytes({
    mutate: (db) =>
      db
        .prepare(
          "INSERT INTO settings (key, value) VALUES ('language', 'he') ON CONFLICT(key) DO UPDATE SET value = 'he'"
        )
        .run(),
  });
  const h = await harness({ local, storedMd5: "md5-1" });
  await h.engine.boot();
  assert.equal(h.events.locales.at(-1), "he");
});

test("offline", async () => {
  const h = await harness({ outbox: [change(1, categoryIds.Restaurants)] });
  h.drive.state.fail = "offline";
  assert.equal(await h.engine.boot(), "ready");
  await h.engine.sync();
  const state = h.engine.getState();
  assert.equal(state.error, "offline");
  assert.equal(state.state, "error");
  assert.equal(state.pendingCount, 1);
  assert.equal(categoryOf(txId), categoryIds.Restaurants, "local edit still shown");
});

test("signed out keeps everything", async () => {
  const h = await harness({ outbox: [change(1, categoryIds.Restaurants)] });
  h.drive.state.fail = "signed_out";
  await h.engine.boot();
  await h.engine.sync();
  assert.equal(h.engine.getState().error, "signed_out");
  assert.ok(h.disk.files.has("snapshot.spent.enc"));
  assert.ok(h.disk.files.has("outbox.bin"));
  assert.equal(h.secrets.map.get("passphrase"), PASS);
  assert.equal(h.events.signOuts, 0);
});

test("background cancels timer", async () => {
  const h = await harness();
  await h.engine.boot();
  await h.engine.sync();
  const before = h.drive.calls.length;

  h.engine.notifyChange();
  h.engine.onBackground();
  h.clock.advance(30_000);
  h.clock.advance(120_000);
  await settle();
  assert.equal(h.drive.calls.length, before, "no sync after background");

  // Control: without going to the background the timer does fire.
  h.engine.notifyChange();
  h.clock.advance(30_000);
  await h.engine.sync();
  assert.ok(h.drive.calls.length > before);
});

test("corrupt outbox is set aside and reported once", async () => {
  const h = await harness({ storedMd5: "md5-1" });
  h.disk.files.set("outbox.bin", Buffer.from("not an outbox").toString("base64"));
  assert.equal(await h.engine.boot(), "ready");
  assert.equal(h.engine.getState().error, "bad_format");
  assert.ok(h.disk.files.has("outbox.corrupt.bin"), "bytes kept aside");
  await h.engine.sync();
  assert.equal(h.engine.getState().error, null);
});

test("outbox under an unknown passphrase is never discarded", async () => {
  const h = await harness({ storedMd5: "md5-1" });
  const foreign = await encryptPayload(
    encoder.encode(JSON.stringify({ formatVersion: 1, changes: [change(1, categoryIds.Restaurants)] })),
    NEW_PASS
  );
  await h.files.writeOutboxBlob(foreign);
  const before = h.disk.files.get("outbox.bin");
  assert.equal(await h.engine.boot(), "ready");
  await h.engine.sync();
  assert.equal(h.engine.getState().error, "bad_passphrase");
  await assert.rejects(h.store.save([]));
  assert.equal(h.disk.files.get("outbox.bin"), before);
});

test("onboarding verifies the passphrase, then connects", async () => {
  const h = await harness({ connected: false });
  assert.deepEqual(await h.engine.listFolders(), [FOLDER]);
  assert.equal(await h.engine.prepareConnection(FOLDER, "not the passphrase at all"), "bad_passphrase");
  assert.equal(h.secrets.map.size, 0);

  assert.equal(await h.engine.prepareConnection(FOLDER, PASS), "ok");
  assert.equal(await h.engine.completeConnection("  "), "ready");
  await h.engine.sync();
  assert.equal(h.secrets.map.get("passphrase"), PASS);
  assert.equal(h.secrets.map.get("folderId"), FOLDER.id);
  assert.equal(h.secrets.map.get("folderName"), FOLDER.name);
  assert.equal(h.secrets.map.get("deviceName"), "Phone");
  assert.match(h.secrets.map.get("deviceId"), /^[0-9a-f]{32}$/);
  assert.ok(h.disk.files.has("snapshot.spent.enc"));
  assert.equal(h.engine.getState().error, null);
});

test("disconnect wipes local data and signs out", async () => {
  const h = await harness({ outbox: [change(1, categoryIds.Restaurants)] });
  await h.engine.boot();
  await h.engine.sync();
  await h.engine.disconnect();
  assert.equal(h.disk.files.size, 0);
  assert.equal(h.secrets.map.size, 0);
  assert.equal(h.events.signOuts, 1);
  assert.equal(h.engine.getState().pendingCount, 0);
  assert.equal(await h.engine.boot(), "needs_onboarding");
});

test("a sync in flight across a new passphrase still re-uploads under the new one", async () => {
  const h = await harness({ outbox: [change(1, categoryIds.Restaurants)], remotePassphrase: NEW_PASS });
  const upload = gate();
  h.drive.state.holdUpload = upload;
  assert.equal(await h.engine.boot(), "ready");
  // The boot sync is uploading under the old passphrase when the new one is entered.
  await until(() => upload.reached, "the boot sync's upload");
  const submitted = h.engine.submitPassphrase(NEW_PASS);
  await until(() => h.secrets.map.get("passphrase") === NEW_PASS, "the new passphrase");
  await settle();
  upload.open();
  assert.equal(await submitted, "ok");
  await h.engine.sync();

  const last = h.drive.uploads.at(-1);
  const file = decodeChangeFile(await decryptPayload(last.bytes, NEW_PASS));
  assert.deepEqual(file.changes.map((c) => c.seq), [1]);
  assert.equal(h.engine.getState().error, null);
});

test("disconnect during a sync leaves nothing behind", async () => {
  const h = await harness({ outbox: [change(1, categoryIds.Restaurants)], storedMd5: "md5-0" });
  const download = gate();
  h.drive.state.holdDownload = download;
  await h.engine.boot();
  await until(() => download.reached, "the boot sync's download");
  const done = h.engine.disconnect();
  await settle();
  download.open();
  await done;
  // Resolves only after any run still in flight has finished.
  await h.engine.sync();

  assert.deepEqual([...h.disk.files.keys()], []);
  assert.deepEqual([...h.secrets.map.keys()], []);
  assert.equal(h.engine.hasData(), false);
  assert.deepEqual(h.engine.getState(), {
    state: "idle",
    lastSyncedAt: null,
    pendingCount: 0,
    error: null,
  });
});

test("a save between re-key and storing the new passphrase uses the new key", async () => {
  const h = await harness({ outbox: [change(1, categoryIds.Restaurants)], remotePassphrase: NEW_PASS });
  await h.engine.boot();
  await h.engine.sync();
  assert.equal(h.engine.getState().error, "bad_passphrase");

  const stored = gate();
  h.secrets.holds.set("passphrase", stored);
  const submitted = h.engine.submitPassphrase(NEW_PASS);
  await until(() => stored.reached, "the passphrase write");
  // The outbox is re-keyed but the secret not yet written: a local edit lands now.
  await h.store.save([change(1, categoryIds.Restaurants), change(2, categoryIds.Groceries)]);
  const plain = await decryptPayload(await h.files.readOutboxBlob(), NEW_PASS);
  assert.equal(JSON.parse(new TextDecoder().decode(plain)).changes.length, 2);

  stored.open();
  assert.equal(await submitted, "ok");
  h.store.reset();
  assert.deepEqual((await h.store.load()).map((c) => c.seq), [1, 2]);
});

test("a snapshot that fails to load leaves the local blob untouched", async () => {
  const state = { failNext: false };
  const h = await harness({
    storedMd5: "md5-1",
    loadDatabase: async (bytes) => {
      if (state.failNext) {
        state.failNext = false;
        throw new Error("could not open");
      }
      return sqljsDb.loadDatabase(bytes);
    },
  });
  await h.engine.boot();
  await h.engine.sync();
  const blobBefore = h.disk.files.get("snapshot.spent.enc");
  const dbBefore = sqljsDb.getDb();

  h.drive.state.remote = await encryptPayload(
    await snapshotBytes({
      mutate: (db) =>
        db.prepare("UPDATE workspaces SET name = 'Never Loaded' WHERE id = ?").run(workspaceId),
    }),
    PASS
  );
  h.drive.state.md5 = "md5-2";
  state.failNext = true;
  await h.engine.sync();

  assert.equal(h.engine.getState().error, "sync_failed");
  assert.equal(h.disk.files.get("snapshot.spent.enc"), blobBefore);
  assert.equal(sqljsDb.getDb(), dbBefore);
  assert.equal(h.secrets.map.get("snapshotMd5"), "md5-1");
});
