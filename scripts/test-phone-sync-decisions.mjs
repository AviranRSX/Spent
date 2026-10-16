import assert from "node:assert/strict";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createTempDataDir,
  registerSrcAliases,
  seedSyntheticWorkspace,
} from "./phone-sync-test-helpers.mjs";

registerSrcAliases();
const dataDir = createTempDataDir("spent-phone-decisions-");

test.after(() => {
  globalThis._db?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("../src/server/db/index.ts");
const { applyUserCategory, approveCategory } = await import(
  "../src/server/lib/category-decisions.ts"
);
const { batchUpdateCategories, batchSetNeedsReview } = await import(
  "../src/server/db/queries/transactions.ts"
);
const { createWorkspace } = await import("../src/server/db/queries/workspaces.ts");
const { APP_SCHEMA_VERSION } = await import("../src/lib/phone-sync/schema-version.ts");

const db = getDb();
const { workspaceId, categoryIds } = await seedSyntheticWorkspace(db);

function aiRow() {
  return db
    .prepare("SELECT id FROM transactions WHERE workspace_id = ? AND description = ?")
    .get(workspaceId, "Wolt · Pizza Domino").id;
}
const getRow = (id) => db.prepare("SELECT * FROM transactions WHERE id = ?").get(id);

test("applyUserCategory matches the old route", () => {
  const id = aiRow();
  const at = "2026-10-01T10:00:00.000Z";
  const res = applyUserCategory(workspaceId, id, categoryIds.Groceries, at);
  assert.deepEqual(res, { ok: true });
  const row = getRow(id);
  assert.equal(row.category_id, categoryIds.Groceries);
  assert.equal(row.category_source, "user");
  assert.equal(row.needs_review, 0);
  assert.equal(row.category_decided_at, at);
  const mem = db
    .prepare("SELECT source, category_id FROM merchant_categories WHERE workspace_id = ?")
    .all(workspaceId);
  assert.equal(mem.length, 1);
  assert.equal(mem[0].source, "user");
  assert.equal(mem[0].category_id, categoryIds.Groceries);
  const corrections = db
    .prepare("SELECT COUNT(*) AS n FROM category_corrections WHERE workspace_id = ?")
    .get(workspaceId).n;
  assert.equal(corrections, 1);
});

test("approveCategory writes approved-ai memory and decided_at", () => {
  const id = aiRow();
  db.prepare("DELETE FROM merchant_categories WHERE workspace_id = ?").run(workspaceId);
  db.prepare(
    "UPDATE transactions SET needs_review = 1, category_decided_at = NULL WHERE id = ?"
  ).run(id);
  const at = "2026-10-02T10:00:00.000Z";
  assert.deepEqual(approveCategory(workspaceId, id, at), { ok: true });
  const row = getRow(id);
  assert.equal(row.needs_review, 0);
  assert.equal(row.category_decided_at, at);
  const mem = db
    .prepare("SELECT source FROM merchant_categories WHERE workspace_id = ?")
    .all(workspaceId);
  assert.deepEqual(
    mem.map((m) => m.source),
    ["approved-ai"]
  );
  assert.deepEqual(approveCategory(workspaceId, 999999, at), {
    ok: false,
    reason: "not_found",
  });
});

test("category from another workspace is rejected and changes nothing", () => {
  const other = createWorkspace("Other Home").id;
  const otherCat = db
    .prepare("SELECT id FROM categories WHERE workspace_id = ? AND kind = 'expense' LIMIT 1")
    .get(other).id;
  const id = aiRow();
  const before = getRow(id);
  assert.deepEqual(
    applyUserCategory(workspaceId, id, otherCat, "2026-10-03T00:00:00.000Z"),
    { ok: false, reason: "category_not_found" }
  );
  assert.deepEqual(getRow(id), before);
  assert.deepEqual(applyUserCategory(workspaceId, 999999, categoryIds.Groceries), {
    ok: false,
    reason: "not_found",
  });
});

test("import and AI do not touch category_decided_at", () => {
  const id = aiRow();
  const at = "2026-10-04T00:00:00.000Z";
  db.prepare(
    "UPDATE transactions SET category_decided_at = ?, category_source = 'ai' WHERE id = ?"
  ).run(at, id);
  batchUpdateCategories(workspaceId, [
    { id, categoryId: categoryIds.Restaurants, aiConfidence: 50 },
  ]);
  batchSetNeedsReview(workspaceId, [{ id, needsReview: true }]);
  assert.equal(getRow(id).category_decided_at, at);
});

test("APP_SCHEMA_VERSION equals the last migration file", () => {
  const files = readdirSync(path.join(process.cwd(), "src/server/db/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  assert.equal(APP_SCHEMA_VERSION, files[files.length - 1]);
});
