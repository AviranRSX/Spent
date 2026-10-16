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
const dataDir = createTempDataDir("spent-phone-writes-");

const { getDb } = await import("../src/server/db/index.ts");
const native = getDb();
const { workspaceId, categoryIds, transactionIds } = await seedSyntheticWorkspace(native);
const file = path.join(dataDir, "snapshot.db");
native.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
const bytes = () => new Uint8Array(readFileSync(file));

const sqljsDb = await import("../src/mobile/db/sqljs-db.ts");
const { handleMobileRequest } = await import("../src/mobile/router.ts");
const { createMemoryOutboxStore } = await import("../src/mobile/storage/outbox-store.ts");
const writes = await import("../src/mobile/local-writes.ts");

test.after(() => {
  native.close();
  if (sqljsDb.isDatabaseLoaded()) sqljsDb.getDb().close();
  rmSync(dataDir, { recursive: true, force: true });
});

const headers = {
  "x-workspace-id": String(workspaceId),
  "Content-Type": "application/json",
};
const txId = transactionIds[0];
const otherTxId = transactionIds[1];
// The AI-categorized row flagged for review: approve needs a category.
const reviewTxId = native
  .prepare("SELECT id FROM transactions WHERE workspace_id = ? AND needs_review = 1")
  .get(workspaceId).id;

function rowOf(id) {
  return sqljsDb
    .getDb()
    .prepare(
      "SELECT category_id AS categoryId, dedup_hash AS dedupHash, needs_review AS needsReview, category_decided_at AS decidedAt FROM transactions WHERE id = ?"
    )
    .get(id);
}

function setup({ ack = 0, store = createMemoryOutboxStore() } = {}) {
  const state = { changes: 0, ack };
  writes.configureLocalWrites({
    outbox: store,
    getAck: () => state.ack,
    onChange: () => {
      state.changes += 1;
    },
  });
  return { store, state };
}

const put = (id, body) =>
  handleMobileRequest(`/api/transactions/${id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
const patch = (id, body) =>
  handleMobileRequest(`/api/transactions/${id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });

test("writes before configuration return 503", async () => {
  await sqljsDb.loadDatabase(bytes());
  const res = await put(txId, { categoryId: categoryIds.Restaurants });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "Phone storage is not ready" });
});

test("PUT records and applies", async () => {
  await sqljsDb.loadDatabase(bytes());
  const { store, state } = setup();
  const before = rowOf(txId);
  const res = await put(txId, { categoryId: categoryIds.Restaurants });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true });
  assert.equal(rowOf(txId).categoryId, categoryIds.Restaurants);
  const saved = await store.load();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].seq, 1);
  assert.equal(saved[0].action, "setCategory");
  assert.equal(saved[0].categoryId, categoryIds.Restaurants);
  assert.equal(saved[0].dedupHash, before.dedupHash);
  assert.equal(saved[0].workspaceId, workspaceId);
  assert.equal(saved[0].transactionId, txId);
  assert.equal(new Date(saved[0].at).toISOString(), saved[0].at);
  assert.equal(state.changes, 1);
  assert.equal(await writes.getPendingCount(), 1);
});

test("approve records", async () => {
  await sqljsDb.loadDatabase(bytes());
  const { store, state } = setup();
  const shown = rowOf(reviewTxId).categoryId;
  assert.ok(shown != null);
  const res = await patch(reviewTxId, { approve: true });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true });
  const saved = await store.load();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].action, "approve");
  // The category the user saw, so the PC can tell if it changed since.
  assert.equal(saved[0].categoryId, shown);
  assert.equal(saved[0].seq, 1);
  assert.equal(state.changes, 1);
});

test("approve of an uncategorized row is refused and not recorded", async () => {
  await sqljsDb.loadDatabase(bytes());
  const { store, state } = setup();
  sqljsDb.getDb().prepare("UPDATE transactions SET category_id = NULL WHERE id = ?").run(reviewTxId);
  const res = await patch(reviewTxId, { approve: true });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "transaction has no category to approve" });
  assert.equal(rowOf(reviewTxId).decidedAt, null);
  assert.equal((await store.load()).length, 0);
  assert.equal(state.changes, 0);
});

test("reapply skips an approve whose category changed in the snapshot", async () => {
  await sqljsDb.loadDatabase(bytes());
  const { store } = setup();
  await patch(reviewTxId, { approve: true });
  const saved = await store.load();
  await sqljsDb.loadDatabase(bytes());
  const other = saved[0].categoryId === categoryIds.Groceries
    ? categoryIds.Restaurants
    : categoryIds.Groceries;
  sqljsDb.getDb().prepare("UPDATE transactions SET category_id = ? WHERE id = ?").run(other, reviewTxId);
  const before = rowOf(reviewTxId);
  writes.reapplyOutbox(saved);
  assert.deepEqual(rowOf(reviewTxId), before);
});

test("seq continues after ack", async () => {
  await sqljsDb.loadDatabase(bytes());
  const { store } = setup({ ack: 5 });
  await put(txId, { categoryId: categoryIds.Restaurants });
  await patch(reviewTxId, { approve: true });
  const saved = await store.load();
  assert.deepEqual(saved.map((c) => c.seq), [6, 7]);
});

test("reapply after fresh snapshot", async () => {
  await sqljsDb.loadDatabase(bytes());
  const { store, state } = setup();
  await put(txId, { categoryId: categoryIds.Restaurants });
  const saved = await store.load();
  await sqljsDb.loadDatabase(bytes());
  assert.notEqual(rowOf(txId).categoryId, categoryIds.Restaurants);
  const changesBefore = state.changes;
  writes.reapplyOutbox([...saved, { ...saved[0], seq: 99, transactionId: 987654 }]);
  assert.equal(rowOf(txId).categoryId, categoryIds.Restaurants);
  assert.equal(rowOf(txId).decidedAt, saved[0].at);
  assert.equal(state.changes, changesBefore);
  assert.equal((await store.load()).length, 1);
});

test("reapply skips an entry the snapshot already has a newer decision for", async () => {
  await sqljsDb.loadDatabase(bytes());
  const { store } = setup();
  await put(txId, { categoryId: categoryIds.Restaurants });
  const saved = await store.load();
  await sqljsDb.loadDatabase(bytes());
  // The PC decided this row after the phone's edit.
  const newer = new Date(Date.parse(saved[0].at) + 60_000).toISOString();
  sqljsDb
    .getDb()
    .prepare("UPDATE transactions SET category_id = ?, category_decided_at = ? WHERE id = ?")
    .run(categoryIds.Groceries, newer, txId);
  writes.reapplyOutbox(saved);
  assert.equal(rowOf(txId).categoryId, categoryIds.Groceries);
  assert.equal(rowOf(txId).decidedAt, newer);
  // A row whose dedup hash no longer matches is skipped too.
  const otherBefore = rowOf(otherTxId);
  writes.reapplyOutbox([
    { ...saved[0], seq: 2, transactionId: otherTxId, at: newer, dedupHash: "other-hash" },
  ]);
  assert.deepEqual(rowOf(otherTxId), otherBefore);
  // Kept in the outbox: the PC skips and acks it.
  assert.equal((await store.load()).length, 1);
});

test("failed results do not record", async () => {
  await sqljsDb.loadDatabase(bytes());
  const { store, state } = setup();
  const missing = await put(987654, { categoryId: categoryIds.Restaurants });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "not found" });
  const badCat = await put(txId, { categoryId: 987654 });
  assert.equal(badCat.status, 400);
  assert.deepEqual(await badCat.json(), {
    error: "categoryId is not a category in this workspace",
  });
  const noCat = await put(txId, {});
  assert.equal(noCat.status, 400);
  assert.deepEqual(await noCat.json(), { error: "categoryId is required" });
  const approveMissing = await patch(987654, { approve: true });
  assert.equal(approveMissing.status, 404);
  assert.equal((await store.load()).length, 0);
  assert.equal(state.changes, 0);
  assert.equal(await writes.getPendingCount(), 0);
});

test("save failure returns 500 and skips onChange", async () => {
  await sqljsDb.loadDatabase(bytes());
  const failing = {
    load: async () => [],
    save: async () => {
      throw new Error("disk full");
    },
  };
  const { state } = setup({ store: failing });
  const res = await put(txId, { categoryId: categoryIds.Restaurants });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "Could not save the change on this phone" });
  assert.equal(state.changes, 0);
});

test("pending count ignores acked entries", async () => {
  await sqljsDb.loadDatabase(bytes());
  const store = createMemoryOutboxStore();
  const { state } = setup({ store });
  await put(txId, { categoryId: categoryIds.Restaurants });
  await patch(reviewTxId, { approve: true });
  assert.equal(await writes.getPendingCount(), 2);
  state.ack = 1;
  assert.equal(await writes.getPendingCount(), 1);
});

test("kind PATCH is not available", async () => {
  const res = await patch(txId, { kind: "transfer" });
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /Not available on the phone: PATCH/);
});
