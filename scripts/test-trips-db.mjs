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

test("migrations 025 to 027 group the travel leaves under Trips & Travel", () => {
  const db = getDb();
  assert.deepEqual(childrenOf(db, 1, "Trips & Travel"), [
    { name: "Activities", budgetMode: "tracking" },
    { name: "Flights", budgetMode: "tracking" },
    { name: "Hotels", budgetMode: "tracking" },
    { name: "Travel", budgetMode: "budgeted" },
    { name: "Travel Insurance", budgetMode: "tracking" },
  ]);
  const travel = getCategoryByName(1, "Travel", "expense");
  assert.match(travel.description, /^Car rental and travel agencies .*NOT tours or attractions \(Activities\), NOT lodging \(Hotels\)/);
  const hotels = getCategoryByName(1, "Hotels", "expense");
  assert.match(hotels.description, /^Lodging: hotels, hostels/);
  assert.match(hotels.description, /NOT tours or attractions \(Activities\)/);
  assert.equal(hotels.icon, "hotel");
  const activities = getCategoryByName(1, "Activities", "expense");
  assert.match(activities.description, /^Things to do on a trip: guided tours/);
  assert.equal(activities.icon, "compass");
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
    { name: "Activities", budgetMode: "tracking" },
    { name: "Flights", budgetMode: "tracking" },
    { name: "Hotels", budgetMode: "tracking" },
    { name: "Travel", budgetMode: "budgeted" },
    { name: "Travel Insurance", budgetMode: "tracking" },
  ]);
});

test("seeded parent map routes the travel leaves to Trips & Travel", () => {
  assert.equal(SEEDED_CATEGORY_PARENTS.Flights, "Trips & Travel");
  assert.equal(SEEDED_CATEGORY_PARENTS.Hotels, "Trips & Travel");
  assert.equal(SEEDED_CATEGORY_PARENTS.Activities, "Trips & Travel");
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

test("migration 026 adds Hotels without touching user edits", () => {
  const edgeDir = mkdtempSync(path.join(tmpRoot, "spent-hotels-edge-"));
  const db = new Database(path.join(edgeDir, "edge.db"));
  try {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    const run = (file) => {
      db.pragma("foreign_keys = OFF");
      db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
      db.pragma("foreign_keys = ON");
    };
    for (const file of files.filter((f) => f < "026")) run(file);

    // Workspace 1 edited its Travel description.
    db.prepare(
      "UPDATE categories SET description = 'My own travel notes' WHERE workspace_id = 1 AND name = 'Travel'"
    ).run();
    // Workspace 2 already has a user-made hotels leaf and no Trips & Travel group.
    db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (2, 'Own', 'own')").run();
    db.prepare(
      `INSERT INTO categories (workspace_id, parent_id, name, color, icon, kind, budget_mode)
       VALUES (2, NULL, 'hotels', '#123456', 'home', 'expense', 'budgeted')`
    ).run();
    // Workspace 3 has no categories, so its Hotels leaf stays ungrouped.
    db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (3, 'Empty', 'empty')").run();

    run("026_hotels.sql");

    assert.ok(childrenOf(db, 1, "Trips & Travel").some((c) => c.name === "Hotels"));
    const travel1 = db
      .prepare("SELECT description FROM categories WHERE workspace_id = 1 AND name = 'Travel'")
      .get();
    assert.equal(travel1.description, "My own travel notes");
    const flights1 = db
      .prepare("SELECT description FROM categories WHERE workspace_id = 1 AND name = 'Flights'")
      .get();
    assert.match(flights1.description, /NOT hotels \(Hotels\)/);

    const hotels2 = db
      .prepare("SELECT name, color FROM categories WHERE workspace_id = 2 AND lower(name) = 'hotels'")
      .all();
    assert.deepEqual(hotels2, [{ name: "hotels", color: "#123456" }]);

    const hotels3 = db
      .prepare("SELECT parent_id AS parentId FROM categories WHERE workspace_id = 3 AND name = 'Hotels'")
      .get();
    assert.equal(hotels3.parentId, null);
  } finally {
    db.close();
    rmSync(edgeDir, { recursive: true, force: true });
  }
});

test("migration 027 adds Activities without touching user edits", () => {
  const edgeDir = mkdtempSync(path.join(tmpRoot, "spent-activities-edge-"));
  const db = new Database(path.join(edgeDir, "edge.db"));
  try {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    const run = (file) => {
      db.pragma("foreign_keys = OFF");
      db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
      db.pragma("foreign_keys = ON");
    };
    for (const file of files.filter((f) => f < "027")) run(file);

    // Workspace 1 edited its Travel description.
    db.prepare(
      "UPDATE categories SET description = 'My own travel notes' WHERE workspace_id = 1 AND name = 'Travel'"
    ).run();
    // Workspace 2 already has a user-made activities leaf and no Trips & Travel group.
    db.prepare("INSERT INTO workspaces (id, name, slug) VALUES (2, 'Own', 'own')").run();
    db.prepare(
      `INSERT INTO categories (workspace_id, parent_id, name, color, icon, kind, budget_mode)
       VALUES (2, NULL, 'activities', '#123456', 'ticket', 'expense', 'budgeted')`
    ).run();

    run("027_activities.sql");

    const activities1 = childrenOf(db, 1, "Trips & Travel").find((c) => c.name === "Activities");
    assert.deepEqual(activities1, { name: "Activities", budgetMode: "tracking" });
    const travel1 = db
      .prepare("SELECT description FROM categories WHERE workspace_id = 1 AND name = 'Travel'")
      .get();
    assert.equal(travel1.description, "My own travel notes");
    const flights1 = db
      .prepare("SELECT description FROM categories WHERE workspace_id = 1 AND name = 'Flights'")
      .get();
    assert.match(flights1.description, /NOT tours \(Activities\)/);
    const parent1 = db
      .prepare("SELECT description FROM categories WHERE workspace_id = 1 AND name = 'Trips & Travel'")
      .get();
    assert.match(parent1.description, /activities/);

    const activities2 = db
      .prepare("SELECT name, color FROM categories WHERE workspace_id = 2 AND lower(name) = 'activities'")
      .all();
    assert.deepEqual(activities2, [{ name: "activities", color: "#123456" }]);
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

test("manual assignments override rules, null marks not a trip, delete reverts", () => {
  const db = getDb();
  const ws = createWorkspace("Trips assign test");
  const other = createWorkspace("Trips assign other");
  const local = tripsQueries.createTrip(ws.id, {
    name: "Galil weekend", country: null, currency: "ILS", startDate: "2026-05-01", endDate: "2026-05-02",
  });
  const [zimmer, dinner] = seedTransactions(db, ws.id, [
    { date: "2026-05-01", currency: "ILS", chargedAmount: -890, description: "Demo Zimmer" },
    { date: "2026-05-02", currency: "ILS", chargedAmount: -240, description: "Demo Dinner" },
  ]);
  const [foreignRow] = seedTransactions(db, other.id, [
    { date: "2026-05-01", currency: "ILS", chargedAmount: -10, description: "Demo Other" },
  ]);

  assert.deepEqual(tripsQueries.setTripAssignments(ws.id, [zimmer, dinner], local.id), { ok: true, count: 2 });
  assert.deepEqual(tripsQueries.getTransactionTripInfo(ws.id, [zimmer])[zimmer], {
    kind: "member", tripId: local.id, tripName: "Galil weekend", reason: "manual",
  });
  assert.equal(tripsQueries.getTripsOverview(ws.id).confirmed[0].total, 1130);

  tripsQueries.setTripAssignments(ws.id, [zimmer], null);
  assert.deepEqual(tripsQueries.getTransactionTripInfo(ws.id, [zimmer])[zimmer], { kind: "none", manualNoTrip: true });

  assert.equal(tripsQueries.clearTripAssignments(ws.id, [zimmer]), 1);
  assert.deepEqual(tripsQueries.getTransactionTripInfo(ws.id, [zimmer])[zimmer], { kind: "none", manualNoTrip: false });

  assert.deepEqual(tripsQueries.setTripAssignments(ws.id, [foreignRow], local.id), { ok: false, reason: "unknown-transactions" });
  assert.deepEqual(tripsQueries.setTripAssignments(other.id, [foreignRow], local.id), { ok: false, reason: "trip-not-found" });
  const suggested = tripsQueries.createTrip(ws.id, {
    name: "Maybe", country: null, currency: "CZK", startDate: "2026-06-01", endDate: "2026-06-02",
  }, "suggested");
  assert.deepEqual(tripsQueries.setTripAssignments(ws.id, [dinner], suggested.id), { ok: false, reason: "trip-not-confirmed" });
  assert.equal(tripsQueries.clearTripAssignments(other.id, [dinner]), 0);

  tripsQueries.deleteTrip(ws.id, local.id);
  const left = db.prepare("SELECT COUNT(*) AS n FROM trip_assignments WHERE transaction_id = ?").get(dinner);
  assert.equal(left.n, 0);
});

test("needs-a-trip queue lists travel rows with ranked suggestions", () => {
  const db = getDb();
  const ws = createWorkspace("Trips queue test");
  const flights = getCategoryByName(ws.id, "Flights", "expense");
  const japan = tripsQueries.createTrip(ws.id, {
    name: "Japan", country: "Japan", currency: "JPY", startDate: "2026-08-01", endDate: "2026-08-10",
  });
  const usa = tripsQueries.createTrip(ws.id, {
    name: "New York", country: "United States", currency: "USD", startDate: "2026-07-15", endDate: "2026-07-20",
  });
  const [flight] = seedTransactions(db, ws.id, [
    { date: "2026-06-20", currency: "$", chargedAmount: -5400, description: "Demo Airways", categoryId: flights.id },
  ]);

  const queue = tripsQueries.getNeedsTripQueue(ws.id);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].transaction.id, flight);
  assert.equal(queue[0].transaction.originalCurrency, "USD");
  assert.equal(queue[0].cause, "travel-category");
  assert.deepEqual(queue[0].suggestions.map((s) => s.id), [usa.id, japan.id]);
  assert.equal(tripsQueries.getNeedsTripCount(ws.id), 1);

  tripsQueries.setTripAssignments(ws.id, [flight], japan.id);
  assert.equal(tripsQueries.getNeedsTripCount(ws.id), 0);
});

test("rejected assignment batches write nothing", () => {
  const db = getDb();
  const ws = createWorkspace("Trips atomic test");
  const other = createWorkspace("Trips atomic other");
  const trip = tripsQueries.createTrip(ws.id, {
    name: "Eilat", country: null, currency: "ILS", startDate: "2026-04-01", endDate: "2026-04-03",
  });
  const dismissed = tripsQueries.createTrip(ws.id, {
    name: "Skipped", country: null, currency: "EUR", startDate: "2026-03-01", endDate: "2026-03-02",
  }, "dismissed");
  const [hotel] = seedTransactions(db, ws.id, [
    { date: "2026-04-01", currency: "ILS", chargedAmount: -700, description: "Demo Hotel" },
  ]);
  const [foreignRow] = seedTransactions(db, other.id, [
    { date: "2026-04-01", currency: "ILS", chargedAmount: -20, description: "Demo Kiosk" },
  ]);
  const countFor = (wsId) =>
    db.prepare("SELECT COUNT(*) AS n FROM trip_assignments WHERE workspace_id IN (?, ?)").get(wsId, other.id).n;

  assert.deepEqual(tripsQueries.setTripAssignments(ws.id, [hotel, foreignRow], trip.id), { ok: false, reason: "unknown-transactions" });
  assert.deepEqual(tripsQueries.setTripAssignments(ws.id, [hotel, foreignRow], null), { ok: false, reason: "unknown-transactions" });
  assert.deepEqual(tripsQueries.setTripAssignments(ws.id, [hotel], dismissed.id), { ok: false, reason: "trip-not-confirmed" });
  assert.deepEqual(tripsQueries.setTripAssignments(ws.id, [hotel], 999999), { ok: false, reason: "trip-not-found" });
  assert.equal(countFor(ws.id), 0);
});

const { detectTripSuggestions, runTripDetectionSafely } = await import(
  "../src/server/trips/detection.ts"
);

test("detection suggests a trip once and never brings a dismissed one back", () => {
  const db = getDb();
  const ws = createWorkspace("Trips detect test");
  seedTransactions(db, ws.id, [
    { date: "2026-06-02", currency: "zł", chargedAmount: -80, description: "Demo Restauracja" },
    { date: "2026-06-03", currency: "zł", chargedAmount: -40, description: "Demo Targ" },
    { date: "2026-06-05", currency: "zł", chargedAmount: -60, description: "Demo Basen" },
    { date: "2026-06-04", currency: "$", chargedAmount: -70, description: "SHEIN.COM DEMO" },
    { date: "2026-06-04", currency: "ILS", chargedAmount: -30, description: "Demo Local" },
    { date: "2026-07-01", currency: "₪", chargedAmount: -30, description: "Demo Local 2" },
  ]);

  const created = detectTripSuggestions(ws.id);
  assert.equal(created.length, 1);
  assert.equal(created[0].status, "suggested");
  assert.equal(created[0].currency, "PLN");
  assert.equal(created[0].name, "Poland Jun 2026");
  assert.equal(created[0].country, "Poland");
  assert.equal(created[0].startDate, "2026-06-02");
  assert.equal(created[0].endDate, "2026-06-05");

  assert.equal(runTripDetectionSafely(ws.id), 0);
  tripsQueries.updateTrip(ws.id, created[0].id, { status: "dismissed" });
  assert.equal(runTripDetectionSafely(ws.id), 0);
});

test("an import commit runs trip detection", async () => {
  const { commitImportFiles } = await import("../src/server/imports/import-transactions.ts");
  const ws = createWorkspace("Trips import hook test");
  const row = (date, originalAmount, description) => ({
    accountNumber: "demo-card",
    date,
    processedDate: date,
    originalAmount,
    originalCurrency: "zł",
    chargedAmount: originalAmount / 100,
    description,
    type: "normal",
    status: "completed",
  });
  await commitImportFiles(
    ws.id,
    ws.name,
    [
      {
        fileName: "demo.xlsx",
        kind: "card",
        templateType: "max_bill",
        rows: [
          row("2026-09-01", -8000, "Demo Restauracja"),
          row("2026-09-02", -4000, "Demo Targ"),
          row("2026-09-03", -6000, "Demo Basen"),
        ],
      },
    ],
    { categorize: false }
  );
  const suggested = tripsQueries.getTripsOverview(ws.id).suggested;
  assert.equal(suggested.length, 1);
  assert.equal(suggested[0].currency, "PLN");
});

test("detection failures never throw from the safe wrapper", () => {
  const db = getDb();
  const ws = createWorkspace("Trips failure test");
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  db.exec("ALTER TABLE trips RENAME TO trips_bak");
  try {
    assert.equal(runTripDetectionSafely(ws.id), 0);
  } finally {
    db.exec("ALTER TABLE trips_bak RENAME TO trips");
    console.error = original;
  }
  assert.equal(logged.length, 1);
  assert.ok(logged[0].startsWith(`Trip detection failed for workspace ${ws.id}:`));
});

test("re-categorize targets the trip's AI-labeled Travel members only", () => {
  const db = getDb();
  const ws = createWorkspace("Trips recategorize test");
  const other = createWorkspace("Trips recategorize other");
  const travel = getCategoryByName(ws.id, "Travel", "expense");
  const restaurants = getCategoryByName(ws.id, "Restaurants", "expense");
  const trip = tripsQueries.createTrip(ws.id, {
    name: "Prague", country: "Czechia", currency: "CZK", startDate: "2026-04-10", endDate: "2026-04-15",
  });
  const [aiTravel] = seedTransactions(db, ws.id, [
    { date: "2026-04-11", currency: "Kč", chargedAmount: -100, description: "Demo Kavarna", categoryId: travel.id },
    { date: "2026-04-11", currency: "Kč", chargedAmount: -900, description: "Demo Hotel", categoryId: travel.id, categorySource: "user" },
    { date: "2026-04-12", currency: "Kč", chargedAmount: -80, description: "Demo Bistro", categoryId: restaurants.id },
    { date: "2026-06-01", currency: "ILS", chargedAmount: -50, description: "Demo Local Tour", categoryId: travel.id },
    { date: "2026-04-13", currency: "Kč", chargedAmount: 60, description: "Demo Tour Refund", categoryId: travel.id, kind: "income" },
  ]);

  const detail = tripsQueries.getTripDetail(ws.id, trip.id);
  assert.ok(detail.members.some((m) => m.description === "Demo Tour Refund"), "income Travel row is a member");
  assert.deepEqual(tripsQueries.getTravelRecategorizeIds(ws.id, trip.id), [aiTravel]);
  assert.equal(tripsQueries.getTripDetail(ws.id, trip.id).travelRecategorizableCount, 1);
  assert.equal(tripsQueries.getTravelRecategorizeIds(other.id, trip.id), null);
});

test("home needs-attention counts include transactions that need a trip", async () => {
  const { getNeedsAttentionCounts } = await import("../src/server/db/queries/home.ts");
  const db = getDb();
  const ws = createWorkspace("Trips home test");
  const flights = getCategoryByName(ws.id, "Flights", "expense");
  seedTransactions(db, ws.id, [
    { date: "2026-06-20", currency: "$", chargedAmount: -5400, description: "Demo Airways", categoryId: flights.id },
  ]);
  assert.equal(getNeedsAttentionCounts(ws.id).needsTrip, 1);
  // Not limited to the month selected on Home: the flight was bought in June.
  assert.equal(
    getNeedsAttentionCounts(ws.id, { from: "2026-09-01", to: "2026-09-30" }).needsTrip,
    1
  );
});
