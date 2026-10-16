import assert from "node:assert/strict";
import fs, {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
  createTempDataDir,
  registerSrcAliases,
  seedSyntheticWorkspace,
} from "./phone-sync-test-helpers.mjs";

registerSrcAliases();
const dataDir = createTempDataDir("spent-phone-engine-");
// encryption.ts keeps its key file under <cwd>/data; run from the temp dir so
// the test never creates or reads a key in the checkout.
const originalCwd = process.cwd();
process.chdir(dataDir);
// Private os.tmpdir() so snapshot temp dirs never race the snapshot test's
// global temp-dir check when test files run in parallel.
const tmpDir = path.join(dataDir, "os-tmp");
mkdirSync(tmpDir);
process.env.TMPDIR = process.env.TEMP = process.env.TMP = tmpDir;

const { getDb } = await import("../src/server/db/index.ts");
const settings = await import("../src/server/phone-sync/settings.ts");
const engine = await import("../src/server/phone-sync/engine.ts");
const { listDevices } = await import("../src/server/phone-sync/devices.ts");
const { encryptPayload, decryptPayload } = await import("../src/lib/phone-sync/crypto.ts");
const { encodeChangeFile } = await import("../src/lib/phone-sync/changes.ts");
const { getTransactionContext } = await import("../src/server/db/queries/transactions.ts");
const { SNAPSHOT_FILE, SNAPSHOT_TMP_FILE, changeFileName } = await import(
  "../src/lib/phone-sync/format.ts"
);

test.after(() => {
  engine.stopPhoneSync();
  globalThis._db?.close();
  process.chdir(originalCwd);
  rmSync(dataDir, { recursive: true, force: true });
});

const PASSPHRASE = "synthetic-pass-phrase";
const db = getDb();
const { workspaceId, categoryIds, transactionIds } = await seedSyntheticWorkspace(db);
settings.setPhoneSyncPassphrase(PASSPHRASE);

let folderCounter = 0;
function newFolder() {
  folderCounter += 1;
  const folder = path.join(dataDir, `drive-${folderCounter}`);
  mkdirSync(folder);
  settings.setPhoneSyncConfig({ enabled: true, folder });
  return folder;
}

async function readSnapshotAcks(folder) {
  const blob = new Uint8Array(readFileSync(path.join(folder, SNAPSHOT_FILE)));
  const plain = await decryptPayload(blob, PASSPHRASE);
  const file = path.join(dataDir, `snapshot-check-${Date.now()}.db`);
  writeFileSync(file, plain);
  const copy = new Database(file, { readonly: true });
  try {
    return JSON.parse(
      copy.prepare("SELECT value FROM phone_sync_meta WHERE key = 'acks'").get().value
    );
  } finally {
    copy.close();
  }
}

function changeEntry(seq, transactionId, categoryId) {
  return {
    seq,
    workspaceId,
    transactionId,
    dedupHash: getTransactionContext(workspaceId, transactionId).dedupHash,
    action: "setCategory",
    categoryId,
    at: "2026-03-01T10:00:00.000Z",
  };
}

async function writeChangeFile(folder, deviceId, changes) {
  const bytes = encodeChangeFile({
    formatVersion: 1,
    deviceId,
    deviceName: "Synthetic Phone",
    changes,
  });
  writeFileSync(
    path.join(folder, changeFileName(deviceId)),
    await encryptPayload(bytes, PASSPHRASE)
  );
}

test("missing folder", async () => {
  const missing = path.join(dataDir, "no-such-drive", "Spent");
  settings.setPhoneSyncConfig({ enabled: true, folder: missing });
  const status = await engine.runPhoneSync();
  assert.equal(status.state, "error");
  assert.equal(status.error, "folder_unavailable");
  assert.equal(existsSync(path.dirname(missing)), false);
});

test("writes snapshot atomically", async () => {
  const folder = newFolder();
  const status = await engine.runPhoneSync();
  assert.equal(status.state, "idle");
  assert.equal(status.error, null);
  assert.ok(status.lastSnapshotAt);
  assert.ok(status.lastSnapshotBytes > 0);
  assert.deepEqual(await readSnapshotAcks(folder), {});
  assert.equal(existsSync(path.join(folder, SNAPSHOT_TMP_FILE)), false);
  assert.deepEqual(readdirSync(folder), [SNAPSHOT_FILE]);
});

test("applies change files and acks in next snapshot", async () => {
  const folder = newFolder();
  const deviceId = "device-apply-01";
  const [a, b] = transactionIds;
  await writeChangeFile(folder, deviceId, [
    changeEntry(1, a, categoryIds.Groceries),
    changeEntry(2, b, categoryIds.Restaurants),
  ]);
  const status = await engine.runPhoneSync();
  assert.equal(status.error, null);
  const device = status.devices.find((d) => d.deviceId === deviceId);
  assert.equal(device.appliedCount, 2);
  assert.equal(device.lastError, null);
  const row = (id) => db.prepare("SELECT category_id FROM transactions WHERE id = ?").get(id);
  assert.equal(row(a).category_id, categoryIds.Groceries);
  assert.equal(row(b).category_id, categoryIds.Restaurants);
  assert.deepEqual(await readSnapshotAcks(folder), { [deviceId]: 2 });

  // Unchanged file: not applied again.
  await engine.runPhoneSync();
  assert.equal(listDevices().find((d) => d.deviceId === deviceId).appliedCount, 2);
});

test("bad change file does not stop sync", async () => {
  const folder = newFolder();
  const badId = "device-corrupt-01";
  const goodId = "device-good-01";
  writeFileSync(path.join(folder, changeFileName(badId)), new Uint8Array([1, 2, 3, 4]));
  await writeChangeFile(folder, goodId, [
    changeEntry(1, transactionIds[2], categoryIds.Groceries),
  ]);
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  let status;
  try {
    status = await engine.runPhoneSync();
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(logged, [
    `[phone-sync] change file for device ${badId} failed: bad_format`,
  ]);
  assert.equal(status.error, null);
  assert.equal(status.state, "idle");
  assert.ok(existsSync(path.join(folder, SNAPSHOT_FILE)));
  const good = status.devices.find((d) => d.deviceId === goodId);
  assert.equal(good.appliedCount, 1);
  const bad = db
    .prepare("SELECT last_error, last_file_mtime_ms FROM phone_sync_devices WHERE device_id = ?")
    .get(badId);
  assert.equal(bad.last_error, "bad_format");
  // Not marked as seen, so it is retried after the cause is fixed.
  assert.equal(bad.last_file_mtime_ms, null);
  const acks = await readSnapshotAcks(folder);
  assert.equal(acks[goodId], 1);
});

test("ignores other names", async () => {
  const folder = newFolder();
  writeFileSync(path.join(folder, "changes-abc.spent.enc.tmp"), "junk");
  writeFileSync(path.join(folder, "notes.txt"), "junk");
  const before = listDevices().length;
  const status = await engine.runPhoneSync();
  assert.equal(status.error, null);
  assert.equal(listDevices().length, before);
  assert.ok(existsSync(path.join(folder, "notes.txt")));
});

test("no passphrase is a status error, not a throw", async () => {
  const folder = newFolder();
  const saved = ["encrypted", "iv", "auth_tag"].map((k) => [
    `phone_sync_passphrase_${k}`,
    db.prepare("SELECT value FROM settings WHERE key = ?").get(`phone_sync_passphrase_${k}`).value,
  ]);
  db.prepare("DELETE FROM settings WHERE key LIKE 'phone_sync_passphrase_%'").run();
  try {
    const status = await engine.runPhoneSync();
    assert.equal(status.state, "error");
    assert.equal(status.error, "no_passphrase");
    assert.equal(existsSync(path.join(folder, SNAPSHOT_FILE)), false);
  } finally {
    const put = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
    for (const [k, v] of saved) put.run(k, v);
  }
});

test("undecryptable stored passphrase is no_passphrase", async () => {
  newFolder();
  const key = "phone_sync_passphrase_encrypted";
  const saved = db.prepare("SELECT value FROM settings WHERE key = ?").get(key).value;
  db.prepare("UPDATE settings SET value = ? WHERE key = ?").run("00ff00ff", key);
  try {
    assert.equal(settings.getPhoneSyncPassphrase(), null);
    const status = await engine.runPhoneSync();
    assert.equal(status.state, "error");
    assert.equal(status.error, "no_passphrase");
  } finally {
    db.prepare("UPDATE settings SET value = ? WHERE key = ?").run(saved, key);
  }
});

test("unexpected failure inside the pass is a status error, cleared by the next sync", async () => {
  const folder = newFolder();
  await engine.runPhoneSync();
  // A local change makes the next pass build a snapshot, and a missing
  // os.tmpdir() makes buildSnapshotDbBytes throw.
  db.prepare("UPDATE transactions SET needs_review = 1 WHERE id = ?").run(transactionIds[4]);
  const missingTmp = path.join(dataDir, "no-such-tmp");
  process.env.TMPDIR = process.env.TEMP = process.env.TMP = missingTmp;
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  let failed;
  try {
    failed = await engine.runPhoneSync();
  } finally {
    console.error = originalError;
    process.env.TMPDIR = process.env.TEMP = process.env.TMP = tmpDir;
  }
  assert.equal(logged.length, 1);
  assert.match(logged[0], /^\[phone-sync\] sync failed:/);
  assert.equal(failed.state, "error");
  assert.equal(failed.error, "sync_failed");

  const before = failed.lastSnapshotAt;
  const ok = await engine.runPhoneSync();
  assert.equal(ok.state, "idle");
  assert.equal(ok.error, null);
  // The local change stayed pending through the failure.
  assert.notEqual(ok.lastSnapshotAt, before);
  assert.ok(existsSync(path.join(folder, SNAPSHOT_FILE)));
});

test("passphrase min length", () => {
  assert.throws(() => settings.setPhoneSyncPassphrase("a".repeat(11)), /at least 12/);
  assert.equal(settings.getPhoneSyncPassphrase(), PASSPHRASE);
});

test("settings route rejects a short passphrase and never echoes it", async () => {
  const { PUT } = await import("../src/app/api/phone-sync/settings/route.ts");
  const res = await PUT(
    new Request("http://127.0.0.1/api/phone-sync/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase: "short-11-ch" }),
    })
  );
  assert.equal(res.status, 400);
  const text = await res.text();
  assert.ok(!text.includes("short-11-ch"));
  assert.equal(settings.getPhoneSyncPassphrase(), PASSPHRASE);
});

test("disabled sync does nothing", async () => {
  const folder = newFolder();
  settings.setPhoneSyncConfig({ enabled: false });
  await engine.initPhoneSync();
  const status = await engine.runPhoneSync();
  assert.equal(status.state, "disabled");
  assert.deepEqual(readdirSync(folder), []);
  assert.equal(globalThis._phoneSync?.scheduler ?? null, null);
});

function fakeClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      nextId += 1;
      timers.set(nextId, { fn, at: now + ms });
      return nextId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
  };
}

async function waitFor(predicate, timeoutMs = 20_000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("local change triggers debounce", async () => {
  newFolder();
  const clock = fakeClock();
  await engine.initPhoneSync({ clock });
  const first = engine.getPhoneSyncStatus();
  assert.equal(first.state, "idle");

  // Nothing changed since the first sync: the watcher stays quiet.
  engine.checkLocalChanges();
  clock.advance(120_000);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(engine.getPhoneSyncStatus().lastSyncedAt, first.lastSyncedAt);

  db.prepare("UPDATE transactions SET needs_review = 0 WHERE id = ?").run(transactionIds[3]);
  engine.checkLocalChanges();
  clock.advance(29_999);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(engine.getPhoneSyncStatus().lastSyncedAt, first.lastSyncedAt);

  clock.advance(1);
  await waitFor(() => engine.getPhoneSyncStatus().lastSyncedAt !== first.lastSyncedAt);
  await waitFor(() => engine.getPhoneSyncStatus().state !== "syncing");
  const after = engine.getPhoneSyncStatus();
  assert.notEqual(after.lastSnapshotAt, first.lastSnapshotAt);

  // The engine's own status writes do not count as a local change.
  engine.checkLocalChanges();
  clock.advance(120_000);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(engine.getPhoneSyncStatus().lastSyncedAt, after.lastSyncedAt);

  engine.stopPhoneSync();
  assert.equal(globalThis._phoneSync?.scheduler ?? null, null);
});

test("an unreadable change file is not retried or re-snapshotted every poll", async () => {
  const folder = newFolder();
  const deviceId = "device-stale-01";
  const phonePassphrase = "synthetic-phone-old-pass";
  const filePath = path.join(folder, changeFileName(deviceId));
  writeFileSync(
    filePath,
    await encryptPayload(
      encodeChangeFile({
        formatVersion: 1,
        deviceId,
        deviceName: "Synthetic Phone",
        changes: [changeEntry(1, transactionIds[5], categoryIds.Restaurants)],
      }),
      phonePassphrase
    )
  );
  const snapshotPath = path.join(folder, SNAPSHOT_FILE);
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  const settle = async (before) => {
    await waitFor(() => engine.getPhoneSyncStatus().lastSyncedAt !== before);
    await waitFor(() => !globalThis._phoneSync.running);
  };
  try {
    await engine.initPhoneSync({ clock: fakeClock() });
    assert.deepEqual(logged, [
      `[phone-sync] change file for device ${deviceId} failed: bad_passphrase`,
    ]);
    assert.ok(existsSync(snapshotPath));

    // Same file, same passphrase: the poll does not sync, and a sync from
    // elsewhere neither re-reads the file nor rewrites the snapshot.
    rmSync(snapshotPath);
    const quiet = engine.getPhoneSyncStatus().lastSyncedAt;
    engine.checkChangeFiles();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(engine.getPhoneSyncStatus().lastSyncedAt, quiet);
    await engine.runPhoneSync();
    await engine.runPhoneSync();
    assert.equal(logged.length, 1);
    assert.equal(existsSync(snapshotPath), false);

    // The file changes: retried once, still nothing new to snapshot.
    const touched = new Date(Date.now() + 5_000);
    utimesSync(filePath, touched, touched);
    let before = engine.getPhoneSyncStatus().lastSyncedAt;
    engine.checkChangeFiles();
    await settle(before);
    assert.equal(logged.length, 2);
    assert.equal(existsSync(snapshotPath), false);
    await engine.runPhoneSync();
    assert.equal(logged.length, 2);

    // The Sync button retries it.
    await engine.syncPhoneNow();
    assert.equal(logged.length, 3);
    assert.equal(existsSync(snapshotPath), false);

    // The PC passphrase changes to the one the phone used: retried and applied.
    settings.setPhoneSyncPassphrase(phonePassphrase);
    before = engine.getPhoneSyncStatus().lastSyncedAt;
    engine.checkChangeFiles();
    await settle(before);
    assert.equal(logged.length, 3);
    const device = listDevices().find((d) => d.deviceId === deviceId);
    assert.equal(device.appliedCount, 1);
    assert.equal(device.lastError, null);
    assert.ok(existsSync(snapshotPath));
  } finally {
    console.error = originalError;
    engine.stopPhoneSync();
    settings.setPhoneSyncPassphrase(PASSPHRASE);
  }
});

test("the write probe runs only when a snapshot is about to be written", async () => {
  newFolder();
  const probes = [];
  let failProbe = false;
  const original = fs.writeFileSync;
  fs.writeFileSync = function (file, ...rest) {
    if (String(file).endsWith(".spent-write-test")) {
      probes.push(file);
      if (failProbe) throw Object.assign(new Error("read-only"), { code: "EACCES", path: file });
    }
    return original.call(this, file, ...rest);
  };
  try {
    await engine.runPhoneSync();
    probes.length = 0;
    // Nothing changed: no snapshot to write, so no probe file in the Drive folder.
    const idle = await engine.runPhoneSync();
    assert.equal(idle.error, null);
    assert.deepEqual(probes, []);

    // A local change needs a snapshot: the probe runs first and reports a
    // read-only folder before any snapshot is built.
    failProbe = true;
    db.prepare("UPDATE transactions SET needs_review = 1 WHERE id = ?").run(transactionIds[6]);
    const failed = await engine.runPhoneSync();
    assert.equal(probes.length, 1);
    assert.equal(failed.error, "not_writable");
  } finally {
    fs.writeFileSync = original;
  }
  const ok = await engine.runPhoneSync();
  assert.equal(ok.error, null);
});

test("folder error matching respects the path separator boundary", () => {
  const folder = path.join(dataDir, "drive-boundary");
  const errAt = (p) => Object.assign(new Error("fs"), { code: "ENOENT", path: p });
  assert.equal(engine.isFsErrorOnPath(errAt(folder), folder), true);
  assert.equal(engine.isFsErrorOnPath(errAt(path.join(folder, SNAPSHOT_FILE)), folder), true);
  assert.equal(engine.isFsErrorOnPath(errAt(folder + path.sep), folder), true);
  assert.equal(engine.isFsErrorOnPath(errAt(`${folder}-other`), folder), false);
  assert.equal(engine.isFsErrorOnPath(errAt(path.join(`${folder}2`, "x")), folder), false);
  assert.equal(engine.isFsErrorOnPath(errAt(folder), null), false);
  assert.equal(engine.isFsErrorOnPath(new Error("no path"), folder), false);
});
