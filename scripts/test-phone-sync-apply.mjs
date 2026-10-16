import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";
import {
  createTempDataDir,
  registerSrcAliases,
  seedSyntheticWorkspace,
} from "./phone-sync-test-helpers.mjs";

registerSrcAliases();
const dataDir = createTempDataDir("spent-phone-apply-");

test.after(() => {
  globalThis._db?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("../src/server/db/index.ts");
const { applyChangeFile } = await import("../src/server/phone-sync/apply-changes.ts");
const { listDevices, getAcks, recordApply } = await import(
  "../src/server/phone-sync/devices.ts"
);
const { batchUpdateCategories, batchSetNeedsReview, getTransactionContext } =
  await import("../src/server/db/queries/transactions.ts");
const { createWorkspace } = await import("../src/server/db/queries/workspaces.ts");

const db = getDb();
const { workspaceId, categoryIds } = await seedSyntheticWorkspace(db);

const txId = db
  .prepare("SELECT id FROM transactions WHERE workspace_id = ? AND description = ?")
  .get(workspaceId, "Wolt · Pizza Domino").id;
const getRow = (id) => db.prepare("SELECT * FROM transactions WHERE id = ?").get(id);
const hash = () => getTransactionContext(workspaceId, txId).dedupHash;

let deviceCounter = 0;
function newDeviceId() {
  deviceCounter += 1;
  return `device-${String(deviceCounter).padStart(4, "0")}`;
}

function resetRow() {
  db.prepare("DELETE FROM merchant_categories WHERE workspace_id = ?").run(workspaceId);
  db.prepare("DELETE FROM category_corrections WHERE workspace_id = ?").run(workspaceId);
  db.prepare(
    `UPDATE transactions SET category_id = ?, category_source = 'ai', needs_review = 1,
       category_decided_at = NULL WHERE id = ?`
  ).run(categoryIds.Restaurants, txId);
}

function entry(seq, extra = {}) {
  return {
    seq,
    workspaceId,
    transactionId: txId,
    dedupHash: hash(),
    action: "setCategory",
    categoryId: categoryIds.Groceries,
    at: "2026-03-01T10:00:00.000Z",
    ...extra,
  };
}

function file(deviceId, changes, deviceName = "Test Phone") {
  return { formatVersion: 1, deviceId, deviceName, changes };
}

const ZERO = { applied: 0, skippedNewer: 0, skippedMismatch: 0, alreadyApplied: 0 };

test("applies setCategory as a user correction", () => {
  resetRow();
  const dev = newDeviceId();
  const res = applyChangeFile(file(dev, [entry(1)]), 1000);
  assert.deepEqual(res, { ...ZERO, applied: 1 });
  const row = getRow(txId);
  assert.equal(row.category_id, categoryIds.Groceries);
  assert.equal(row.category_source, "user");
  assert.equal(row.needs_review, 0);
  assert.equal(row.category_decided_at, "2026-03-01T10:00:00.000Z");
  const mem = db
    .prepare("SELECT source, category_id FROM merchant_categories WHERE workspace_id = ?")
    .all(workspaceId);
  assert.equal(mem.length, 1);
  assert.equal(mem[0].source, "user");
  assert.equal(mem[0].category_id, categoryIds.Groceries);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS n FROM category_corrections WHERE workspace_id = ?")
      .get(workspaceId).n,
    1
  );
});

test("applies approve and applies entries in seq order", () => {
  resetRow();
  const dev = newDeviceId();
  const res = applyChangeFile(
    file(dev, [
      entry(2, {
        action: "approve",
        categoryId: categoryIds.Transfers,
        at: "2026-03-02T10:00:00.000Z",
      }),
      entry(1, { categoryId: categoryIds.Transfers }),
    ]),
    1000
  );
  assert.deepEqual(res, { ...ZERO, applied: 2 });
  const row = getRow(txId);
  assert.equal(row.category_id, categoryIds.Transfers);
  assert.equal(row.category_decided_at, "2026-03-02T10:00:00.000Z");
  assert.equal(row.needs_review, 0);
});

test("idempotent: applying the same file twice changes nothing more", () => {
  resetRow();
  const dev = newDeviceId();
  const f = file(dev, [entry(1), entry(2, { categoryId: categoryIds.Restaurants })]);
  assert.deepEqual(applyChangeFile(f, 1000), { ...ZERO, applied: 2 });
  const after = getRow(txId);
  assert.deepEqual(applyChangeFile(f, 2000), { ...ZERO, alreadyApplied: 2 });
  assert.deepEqual(getRow(txId), after);
  const d = listDevices().find((x) => x.deviceId === dev);
  assert.equal(d.appliedCount, 2);
  assert.equal(d.lastAppliedSeq, 2);
});

test("newer PC decision wins", () => {
  resetRow();
  const dev = newDeviceId();
  db.prepare(
    "UPDATE transactions SET category_id = ?, category_source = 'user', category_decided_at = ? WHERE id = ?"
  ).run(categoryIds.Restaurants, "2026-03-02T10:00:00.000Z", txId);
  const before = getRow(txId);
  const res = applyChangeFile(file(dev, [entry(1, { at: "2026-03-01T10:00:00.000Z" })]), 1000);
  assert.deepEqual(res, { ...ZERO, skippedNewer: 1 });
  assert.deepEqual(getRow(txId), before);
  assert.equal(getAcks()[dev], 1);
});

test("newer PC decision also skips approve; equal timestamp applies", () => {
  resetRow();
  const dev = newDeviceId();
  const at = "2026-03-05T10:00:00.000Z";
  db.prepare("UPDATE transactions SET category_decided_at = ? WHERE id = ?").run(at, txId);
  const res = applyChangeFile(
    file(dev, [
      entry(1, {
        action: "approve",
        categoryId: categoryIds.Restaurants,
        at: "2026-03-04T10:00:00.000Z",
      }),
      entry(2, { at }),
    ]),
    1000
  );
  assert.deepEqual(res, { ...ZERO, skippedNewer: 1, applied: 1 });
});

test("import after phone edit does not block", () => {
  resetRow();
  const dev = newDeviceId();
  const at = "2026-03-01T10:00:00.000Z";
  // An import or AI pass touches the row after the phone edit time.
  db.prepare("UPDATE transactions SET updated_at = ? WHERE id = ?").run(
    "2026-03-03T10:00:00.000Z",
    txId
  );
  batchUpdateCategories(workspaceId, [
    { id: txId, categoryId: categoryIds.Restaurants, aiConfidence: 50 },
  ]);
  batchSetNeedsReview(workspaceId, [{ id: txId, needsReview: true }]);
  assert.equal(getRow(txId).category_decided_at, null);
  const res = applyChangeFile(file(dev, [entry(1, { at })]), 1000);
  assert.deepEqual(res, { ...ZERO, applied: 1 });
  assert.equal(getRow(txId).category_id, categoryIds.Groceries);
});

test("mismatch cases skip and leave the DB unchanged", () => {
  resetRow();
  const other = createWorkspace("Other Home").id;
  const otherCat = db
    .prepare("SELECT id FROM categories WHERE workspace_id = ? AND kind = 'expense' LIMIT 1")
    .get(other).id;
  const cases = {
    "deleted transaction": entry(1, { transactionId: 999999 }),
    "wrong dedupHash": entry(1, { dedupHash: "0".repeat(64) }),
    "category in another workspace": entry(1, { categoryId: otherCat }),
    "deleted category": entry(1, { categoryId: 99999999 }),
    "approve on deleted transaction": entry(1, {
      action: "approve",
      categoryId: categoryIds.Restaurants,
      transactionId: 999999,
    }),
    // The phone approved Groceries, but the row is Restaurants now.
    "approve of a category that changed since": entry(1, {
      action: "approve",
      categoryId: categoryIds.Groceries,
    }),
  };
  for (const [name, change] of Object.entries(cases)) {
    const before = getRow(txId);
    const res = applyChangeFile(file(newDeviceId(), [change]), 1000);
    assert.deepEqual(res, { ...ZERO, skippedMismatch: 1 }, name);
    assert.deepEqual(getRow(txId), before, name);
  }
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS n FROM merchant_categories WHERE workspace_id = ?")
      .get(workspaceId).n,
    0
  );
});

test("two devices are independent", () => {
  resetRow();
  const a = newDeviceId();
  const b = newDeviceId();
  assert.deepEqual(applyChangeFile(file(a, [entry(5)]), 1000), { ...ZERO, applied: 1 });
  resetRow();
  assert.deepEqual(applyChangeFile(file(b, [entry(1)]), 1000), { ...ZERO, applied: 1 });
  const acks = getAcks();
  assert.equal(acks[a], 5);
  assert.equal(acks[b], 1);
});

test("counts, name and mtime are persisted; ack never goes backwards", () => {
  resetRow();
  const dev = newDeviceId();
  applyChangeFile(
    file(
      dev,
      [entry(1), entry(2, { dedupHash: "bad" }), entry(3, { at: "2026-02-01T00:00:00.000Z" })],
      "Pixel A"
    ),
    1234
  );
  let d = listDevices().find((x) => x.deviceId === dev);
  assert.equal(d.deviceName, "Pixel A");
  assert.equal(d.lastFileMtimeMs, 1234);
  assert.equal(d.appliedCount, 1);
  assert.equal(d.skippedMismatchCount, 1);
  assert.equal(d.skippedNewerCount, 1);
  assert.equal(d.lastAppliedSeq, 3);

  // An older file arriving after a newer one must not lower the ack.
  const res = applyChangeFile(file(dev, [entry(2)], "Pixel B"), 2000);
  assert.deepEqual(res, { ...ZERO, alreadyApplied: 1 });
  recordApply(dev, { lastAppliedSeq: 1, applied: 0, skippedNewer: 0, skippedMismatch: 0 });
  d = listDevices().find((x) => x.deviceId === dev);
  assert.equal(d.lastAppliedSeq, 3);
  assert.equal(getAcks()[dev], 3);
  assert.equal(d.deviceName, "Pixel B");
});

test("an error mid-file applies nothing from that file", () => {
  resetRow();
  const dev = newDeviceId();
  const before = getRow(txId);
  // An object id cannot be bound by sqlite, so the lookup throws.
  const bad = entry(2, { transactionId: {} });
  assert.throws(() => applyChangeFile(file(dev, [entry(1), bad]), 1000));
  assert.deepEqual(getRow(txId), before);
  assert.equal(getAcks()[dev], undefined);
});
