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

let hashCounter = 0;
function seedTransactions(db, workspaceId, rows) {
  const syncRunId = db
    .prepare(
      `INSERT INTO sync_runs (workspace_id, provider, started_at, status, scrape_from_date)
       VALUES (?, 'max_bill', '2026-01-01', 'completed', '2026-01-01')`
    )
    .run(workspaceId).lastInsertRowid;
  const insert = db.prepare(
    `INSERT INTO transactions
       (workspace_id, account_number, date, processed_date, original_amount,
        original_currency, charged_amount, description, type, status,
        provider, sync_run_id, dedup_hash, kind, category_id, category_source)
     VALUES (?, 'demo-card', ?, ?, ?, ?, ?, ?, 'normal', ?, 'max_bill', ?, ?, ?, ?, ?)`
  );
  return rows.map((row) =>
    Number(
      insert.run(
        workspaceId,
        row.date,
        row.date,
        row.originalAmount ?? row.chargedAmount,
        row.currency,
        row.chargedAmount,
        row.description,
        row.status ?? "completed",
        syncRunId,
        `trips-test-${hashCounter++}`,
        row.kind ?? "expense",
        row.categoryId ?? null,
        row.categorySource ?? (row.categoryId ? "ai" : null)
      ).lastInsertRowid
    )
  );
}

const tripsQueries = await import("../src/server/db/queries/trips.ts");

test("trip overview counts completed members only and exposes the queue size", () => {
  const db = getDb();
  const ws = createWorkspace("Trips totals test");
  const other = createWorkspace("Trips other workspace");
  const restaurants = getCategoryByName(ws.id, "Restaurants", "expense");
  const flights = getCategoryByName(ws.id, "Flights", "expense");
  const trip = tripsQueries.createTrip(ws.id, {
    name: "Prague",
    country: "Czechia",
    currency: "CZK",
    startDate: "2026-04-10",
    endDate: "2026-04-15",
  });

  seedTransactions(db, ws.id, [
    { date: "2026-04-11", currency: "Kč", chargedAmount: -100, description: "Demo Kavarna", categoryId: restaurants.id },
    { date: "2026-04-12", currency: "€", chargedAmount: -50, description: "Demo Exchange" },
    { date: "2026-04-13", currency: "Kč", chargedAmount: -30, description: "Demo Bistro", status: "pending" },
    { date: "2026-04-14", currency: "Kč", chargedAmount: 20, description: "Demo Refund" },
    { date: "2026-04-12", currency: "ILS", chargedAmount: -40, description: "Demo Ride App" },
    { date: "2026-03-01", currency: "$", chargedAmount: -700, description: "Demo Airways", categoryId: flights.id },
    { date: "2026-04-12", currency: "Kč", chargedAmount: -999, description: "Demo Transfer", kind: "transfer" },
  ]);

  const overview = tripsQueries.getTripsOverview(ws.id);
  assert.equal(overview.confirmed.length, 1);
  assert.equal(overview.confirmed[0].total, 130);
  assert.equal(overview.confirmed[0].memberCount, 4);
  assert.equal(overview.confirmed[0].days, 6);
  assert.equal(overview.needsTripCount, 1);

  const detail = tripsQueries.getTripDetail(ws.id, trip.id);
  assert.equal(detail.during, 130);
  assert.equal(detail.before, 0);
  assert.equal(detail.pendingCount, 1);
  assert.equal(detail.members.length, 4);
  assert.equal(detail.members[0].originalCurrency, "CZK");

  assert.equal(tripsQueries.getTripDetail(other.id, trip.id), null);
  assert.equal(tripsQueries.getTripsOverview(other.id).confirmed.length, 0);
});

test("suggested trips preview their totals and CRUD stays inside the workspace", () => {
  const db = getDb();
  const ws = createWorkspace("Trips crud test");
  const other = createWorkspace("Trips crud other");
  seedTransactions(db, ws.id, [
    { date: "2026-06-02", currency: "zł", chargedAmount: -80, description: "Demo Restauracja" },
    { date: "2026-06-03", currency: "zł", chargedAmount: -40, description: "Demo Targ" },
  ]);
  const suggested = tripsQueries.createTrip(
    ws.id,
    { name: "Poland Jun 2026", country: "Poland", currency: "PLN", startDate: "2026-06-02", endDate: "2026-06-03" },
    "suggested"
  );
  const overview = tripsQueries.getTripsOverview(ws.id);
  assert.equal(overview.confirmed.length, 0);
  assert.equal(overview.suggested[0].total, 120);

  assert.equal(tripsQueries.updateTrip(other.id, suggested.id, { status: "confirmed" }), null);
  const confirmed = tripsQueries.updateTrip(ws.id, suggested.id, { status: "confirmed", name: "Krakow" });
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.name, "Krakow");

  assert.equal(tripsQueries.deleteTrip(other.id, suggested.id), false);
  assert.equal(tripsQueries.deleteTrip(ws.id, suggested.id), true);
  assert.equal(tripsQueries.getTrip(ws.id, suggested.id), null);
});

test("trip totals skip members categorized Transfers but still list them", () => {
  const db = getDb();
  const ws = createWorkspace("Trips transfers test");
  const restaurants = getCategoryByName(ws.id, "Restaurants", "expense");
  const transfers = getCategoryByName(ws.id, "Transfers", "expense");
  assert.ok(transfers, "seeded Transfers expense category");
  const trip = tripsQueries.createTrip(ws.id, {
    name: "Lisbon",
    country: "Portugal",
    currency: "EUR",
    startDate: "2026-09-10",
    endDate: "2026-09-12",
  });
  const [normalId, transferId] = seedTransactions(db, ws.id, [
    { date: "2026-09-10", currency: "EUR", chargedAmount: -120, description: "Demo Tasca", categoryId: restaurants.id },
    { date: "2026-09-11", currency: "EUR", chargedAmount: -800, description: "Demo Wallet Topup", categoryId: transfers.id },
  ]);

  const detail = tripsQueries.getTripDetail(ws.id, trip.id);
  assert.equal(detail.total, 120);
  assert.equal(detail.during, 120);
  assert.deepEqual(detail.breakdown.map((s) => s.name), ["Restaurants"]);
  assert.deepEqual(detail.members.map((m) => m.id).sort((a, b) => a - b), [normalId, transferId].sort((a, b) => a - b));
  assert.equal(tripsQueries.getTripsOverview(ws.id).confirmed[0].total, 120);
});

test("trip dates round-trip as plain days", () => {
  const ws = createWorkspace("Trips dates test");
  const trip = tripsQueries.createTrip(ws.id, {
    name: "Day trip",
    country: null,
    currency: "ILS",
    startDate: "2026-03-03",
    endDate: "2026-03-03",
  });
  const read = tripsQueries.getTrip(ws.id, trip.id);
  assert.equal(read.startDate, "2026-03-03");
  assert.equal(read.endDate, "2026-03-03");
  const detail = tripsQueries.getTripDetail(ws.id, trip.id);
  assert.equal(detail.total, 0);
  assert.equal(detail.perDay, 0);
  assert.deepEqual(detail.daily, [{ date: "2026-03-03", amount: 0 }]);
});
