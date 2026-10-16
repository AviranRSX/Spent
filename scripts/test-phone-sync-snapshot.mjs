import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
  createTempDataDir,
  registerSrcAliases,
  seedSyntheticWorkspace,
} from "./phone-sync-test-helpers.mjs";

registerSrcAliases();
const dataDir = createTempDataDir("spent-phone-snapshot-");

test.after(() => {
  globalThis._db?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("../src/server/db/index.ts");
const { buildSnapshotDbBytes, SNAPSHOT_SECRET_SETTING_PATTERNS } = await import(
  "../src/server/phone-sync/snapshot.ts"
);
const { APP_SCHEMA_VERSION } = await import("../src/lib/phone-sync/schema-version.ts");

const db = getDb();
const { workspaceId } = await seedSyntheticWorkspace(db);

const MARKERS = [
  "SECRET-MARKER-1",
  "SECRET-MARKER-2",
  "SECRET-MARKER-3",
  "SECRET-MARKER-4",
  "SECRET-MARKER-CRED",
];
const secretSettings = {
  ai_api_key_encrypted: MARKERS[0],
  ai_api_key_iv: MARKERS[1],
  ai_api_key_auth_tag: MARKERS[2],
  phone_sync_passphrase_encrypted: MARKERS[3],
};
const upsert = db.prepare(
  `INSERT INTO settings (key, value) VALUES (?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`
);
for (const [k, v] of Object.entries(secretSettings)) upsert.run(k, v);
upsert.run("language", "he");
db.prepare(
  `INSERT INTO bank_credentials (workspace_id, provider, label, credentials_encrypted, iv, auth_tag)
   VALUES (?, 'hapoalim', 'Synthetic', ?, ?, ?)`
).run(workspaceId, Buffer.from(MARKERS[4]), Buffer.from("iv-bytes"), Buffer.from("tag-bytes"));

function openBytes(bytes) {
  const dir = mkdtempSync(path.join(dataDir, "open-"));
  const file = path.join(dir, "snap.db");
  writeFileSync(file, bytes);
  return new Database(file, { readonly: true });
}

function count(d, table) {
  return d.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}

function snapshotTempFiles() {
  return readdirSync(os.tmpdir()).filter((f) => f.startsWith("spent-snapshot-"));
}

test("exports the secret setting patterns", () => {
  assert.deepEqual(SNAPSHOT_SECRET_SETTING_PATTERNS, [
    "%_encrypted",
    "%_iv",
    "%_auth_tag",
    "phone_sync_%",
  ]);
});

test("strips secrets", () => {
  const bytes = buildSnapshotDbBytes({ acks: {} });
  const snap = openBytes(bytes);
  try {
    assert.equal(count(snap, "bank_credentials"), 0);
    const keys = snap.prepare("SELECT key FROM settings").all().map((r) => r.key);
    for (const k of Object.keys(secretSettings)) assert.ok(!keys.includes(k), k);
    assert.equal(
      snap.prepare("SELECT value FROM settings WHERE key = 'language'").get().value,
      "he"
    );
  } finally {
    snap.close();
  }
  const buf = Buffer.from(bytes);
  for (const m of MARKERS) assert.equal(buf.indexOf(m), -1, `${m} leaked`);
});

test("keeps data", () => {
  const snap = openBytes(buildSnapshotDbBytes({ acks: {} }));
  try {
    for (const t of ["transactions", "categories", "budgets", "trips", "workspaces"]) {
      assert.equal(count(snap, t), count(db, t), t);
    }
  } finally {
    snap.close();
  }
});

test("meta carries acks, version and schema", () => {
  const now = new Date("2026-01-02T03:04:05.000Z");
  const snap = openBytes(buildSnapshotDbBytes({ acks: { "dev-a": 3 }, now }));
  try {
    const meta = Object.fromEntries(
      snap
        .prepare("SELECT key, value FROM phone_sync_meta")
        .all()
        .map((r) => [r.key, r.value])
    );
    assert.equal(meta.format_version, "1");
    assert.equal(meta.created_at, now.toISOString());
    assert.deepEqual(JSON.parse(meta.acks), { "dev-a": 3 });
    assert.equal(
      snap.prepare("SELECT MAX(name) AS m FROM _migrations").get().m,
      APP_SCHEMA_VERSION
    );
  } finally {
    snap.close();
  }
});

test("no temp files left, including on error after VACUUM INTO", () => {
  const before = snapshotTempFiles();
  buildSnapshotDbBytes({ acks: {} });
  assert.deepEqual(snapshotTempFiles(), before);
  assert.throws(
    () =>
      buildSnapshotDbBytes({
        acks: {},
        afterCopy: () => {
          assert.ok(snapshotTempFiles().length > before.length);
          throw new Error("injected");
        },
      }),
    /injected/
  );
  assert.deepEqual(snapshotTempFiles(), before);
});

test("live db untouched", () => {
  buildSnapshotDbBytes({ acks: {} });
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE '%_encrypted'").get().n,
    2
  );
  assert.equal(count(db, "bank_credentials"), 1);
  assert.equal(
    db.prepare("SELECT name FROM sqlite_master WHERE name = 'phone_sync_meta'").get(),
    undefined
  );
});
