import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import Database from "better-sqlite3";

const srcRoot = path.join(process.cwd(), "src");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const target = path.join(srcRoot, specifier.slice(2));
      const withExt = path.extname(target) === "" ? `${target}.ts` : target;
      return nextResolve(pathToFileURL(withExt).href, context);
    }
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

const tmpRoot = path.join(process.cwd(), ".tmp-tests");
mkdirSync(tmpRoot, { recursive: true });
const dataDir = mkdtempSync(path.join(tmpRoot, "spent-trips-"));
process.env.SPENT_DATA_DIR = dataDir;

test.after(() => {
  globalThis._db?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const { getDb } = await import("../src/server/db/index.ts");
const { createWorkspace } = await import("../src/server/db/queries/workspaces.ts");
const { getCategoryByName, SEEDED_CATEGORY_PARENTS } = await import(
  "../src/server/db/queries/categories.ts"
);

const migrationsDir = path.join(process.cwd(), "src", "server", "db", "migrations");

function childrenOf(db, workspaceId, parentName) {
  return db
    .prepare(
      `SELECT c.name, c.budget_mode AS budgetMode
       FROM categories c
       JOIN categories p ON p.id = c.parent_id
       WHERE c.workspace_id = ? AND p.name = ? AND p.parent_id IS NULL
       ORDER BY c.name`
    )
    .all(workspaceId, parentName);
}

test("migration 025 groups Flights, Travel and Travel Insurance under Trips & Travel", () => {
  const db = getDb();
  assert.deepEqual(childrenOf(db, 1, "Trips & Travel"), [
    { name: "Flights", budgetMode: "tracking" },
    { name: "Travel", budgetMode: "budgeted" },
    { name: "Travel Insurance", budgetMode: "tracking" },
  ]);
  const travel = getCategoryByName(1, "Travel", "expense");
  assert.match(travel.description, /^Lodging, tours, car rental and travel agencies \(hotels/);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'trip%' ORDER BY name")
    .all()
    .map((row) => row.name);
  assert.deepEqual(tables, ["trip_assignments", "trips"]);
});

test("new workspaces get the Trips & Travel group", () => {
  const db = getDb();
  const ws = createWorkspace("Trips seed test");
  assert.deepEqual(childrenOf(db, ws.id, "Trips & Travel"), [
    { name: "Flights", budgetMode: "tracking" },
    { name: "Travel", budgetMode: "budgeted" },
    { name: "Travel Insurance", budgetMode: "tracking" },
  ]);
});

test("seeded parent map routes the travel leaves to Trips & Travel", () => {
  assert.equal(SEEDED_CATEGORY_PARENTS.Flights, "Trips & Travel");
  assert.equal(SEEDED_CATEGORY_PARENTS.Travel, "Trips & Travel");
  assert.equal(SEEDED_CATEGORY_PARENTS["Travel Insurance"], "Trips & Travel");
});

test("migration 025 handles missing Travel and pre-existing names", () => {
  const edgeDir = mkdtempSync(path.join(tmpRoot, "spent-trips-edge-"));
  const db = new Database(path.join(edgeDir, "edge.db"));
  try {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    const run = (file) => {
      db.pragma("foreign_keys = OFF");
      db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
      db.pragma("foreign_keys = ON");
    };
    for (const file of files.filter((f) => f < "025")) run(file);

    // Workspace 1 already has a user-made Flights leaf under Lifestyle.
    const lifestyle = db
      .prepare("SELECT id FROM categories WHERE workspace_id = 1 AND name = 'Lifestyle' AND parent_id IS NULL")
      .get();
    db.prepare(
      `INSERT INTO categories (workspace_id, parent_id, name, color, icon, kind, budget_mode)
       VALUES (1, ?, 'Flights', '#123456', 'plane', 'expense', 'budgeted')`
    ).run(lifestyle.id);

    // Workspace 2 has no categories at all, so no Travel to move.
    db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (2, 'Empty', 'empty')").run();

    // Workspace 3 has a leaf called Trips & Travel inside another group.
    db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (3, 'Odd', 'odd')").run();
    const oddParent = db
      .prepare(
        `INSERT INTO categories (workspace_id, parent_id, name, color, icon, kind, budget_mode)
         VALUES (3, NULL, 'Lifestyle', '#D692BF', 'sparkles', 'expense', 'tracking')`
      )
      .run().lastInsertRowid;
    db.prepare(
      `INSERT INTO categories (workspace_id, parent_id, name, color, icon, kind, budget_mode)
       VALUES (3, ?, 'Trips & Travel', '#4FA3A5', 'plane', 'expense', 'budgeted')`
    ).run(oddParent);
    db.prepare(
      `INSERT INTO categories (workspace_id, parent_id, name, color, icon, kind, budget_mode)
       VALUES (3, NULL, 'Travel', '#64B8D2', 'plane', 'expense', 'budgeted')`
    ).run();

    run("025_trips.sql");

    const flights1 = db
      .prepare("SELECT color, budget_mode AS budgetMode FROM categories WHERE workspace_id = 1 AND name = 'Flights'")
      .all();
    assert.deepEqual(flights1, [{ color: "#123456", budgetMode: "budgeted" }]);
    assert.deepEqual(
      childrenOf(db, 1, "Trips & Travel").map((c) => c.name),
      ["Flights", "Travel", "Travel Insurance"]
    );

    assert.deepEqual(childrenOf(db, 2, "Trips & Travel"), [
      { name: "Flights", budgetMode: "tracking" },
      { name: "Travel Insurance", budgetMode: "tracking" },
    ]);

    const travel3 = db
      .prepare("SELECT parent_id AS parentId FROM categories WHERE workspace_id = 3 AND name = 'Travel'")
      .get();
    assert.equal(travel3.parentId, null);
    const tripsLeaf3 = db
      .prepare("SELECT parent_id AS parentId FROM categories WHERE workspace_id = 3 AND name = 'Trips & Travel'")
      .get();
    assert.equal(tripsLeaf3.parentId, Number(oddParent));
    const count3 = db
      .prepare("SELECT COUNT(*) AS n FROM categories WHERE workspace_id = 3 AND name IN ('Flights', 'Travel Insurance')")
      .get();
    assert.equal(count3.n, 2);
  } finally {
    db.close();
    rmSync(edgeDir, { recursive: true, force: true });
  }
});
