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
const dataDir = createTempDataDir("spent-phone-router-");

const { getDb } = await import("../src/server/db/index.ts");
const native = getDb();
const { workspaceId } = await seedSyntheticWorkspace(native);
const file = path.join(dataDir, "snapshot.db");
native.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
const lowestId = native.prepare("SELECT MIN(id) AS id FROM workspaces").get().id;

const sqljsDb = await import("../src/mobile/db/sqljs-db.ts");
const { handleMobileRequest } = await import("../src/mobile/router.ts");

test.after(() => {
  native.close();
  if (sqljsDb.isDatabaseLoaded()) sqljsDb.getDb().close();
  rmSync(dataDir, { recursive: true, force: true });
});

test("getDb throws before load", () => {
  assert.equal(sqljsDb.isDatabaseLoaded(), false);
  assert.throws(() => sqljsDb.getDb(), /Database not loaded/);
});

test("routes home", async () => {
  await sqljsDb.loadDatabase(new Uint8Array(readFileSync(file)));
  assert.equal(sqljsDb.isDatabaseLoaded(), true);
  const res = await handleMobileRequest("/api/home?month=2026-03", {
    headers: { "x-workspace-id": String(workspaceId) },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.kpis);
});

test("routes path params", async () => {
  const cats = await (
    await handleMobileRequest("/api/categories", {
      headers: { "x-workspace-id": String(workspaceId) },
    })
  ).json();
  const res = await handleMobileRequest(`/api/categories/${cats[0].id}/detail`, {
    headers: { "x-workspace-id": String(workspaceId) },
  });
  assert.equal(res.status, 200);
});

test("activity is idle", async () => {
  const res = await handleMobileRequest("/api/activity");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.sync.active, false);
  assert.equal(body.scheduler.armed, false);
  assert.equal(body.ollama.running, false);
});

test("unknown path is 404 with clear message", async () => {
  const res = await handleMobileRequest("/api/imports/commit", { method: "POST" });
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.match(body.error, /Not available on the phone/);
  assert.match(body.error, /POST \/api\/imports\/commit/);
});

test("non-GET on a known path is 404", async () => {
  const res = await handleMobileRequest("/api/categories", { method: "POST" });
  assert.equal(res.status, 404);
});

test("missing workspace header falls back to lowest id", async () => {
  const get = async (headers) =>
    (await handleMobileRequest("/api/categories", { headers })).json();
  const none = await get(undefined);
  const lowest = await get({ "x-workspace-id": String(lowestId) });
  const bogus = await get(new Headers({ "x-workspace-id": "99999" }));
  assert.deepEqual(none, lowest);
  assert.deepEqual(bogus, lowest);
  if (workspaceId !== lowestId) {
    const seeded = await get({ "x-workspace-id": String(workspaceId) });
    assert.notDeepEqual(seeded, lowest);
  }
});

// GETs the five phone screens and the sidebar make once desktop-only controls
// are hidden. Built from the src/lib/api.ts callers on those screens.
test("every GET used by phone screens is routed", async () => {
  const headers = { "x-workspace-id": String(workspaceId) };
  const get = (url) => handleMobileRequest(url, { headers });
  const categories = await (await get("/api/categories")).json();
  const overview = await (await get("/api/trips")).json();
  const tripId = overview.confirmed[0].id;
  const txns = await (await get("/api/transactions?limit=5")).json();
  const ids = txns.transactions.map((t) => `ids=${t.id}`).join("&");
  const range = "from=2026-01-01&to=2026-12-31";

  const paths = [
    // Sidebar and workspace switcher.
    "/api/workspaces",
    "/api/trips",
    // Home.
    "/api/home?month=2026-03",
    // Budget.
    `/api/summary?${range}`,
    "/api/categories",
    `/api/categories/${categories[0].id}/detail?${range}`,
    // Transactions and Credit card.
    `/api/transactions?${range}&limit=50&offset=0&sort=date&order=desc`,
    `/api/transactions?${range}&limit=50&offset=0&sourceType=card&needsReview=true`,
    `/api/transactions/summary?${range}`,
    `/api/transactions/summary?${range}&sourceType=card`,
    `/api/transactions/account-numbers?${range}&sourceType=card`,
    `/api/summary?${range}&sourceType=card`,
    "/api/categories?kind=income",
    "/api/categories?kind=expense",
    "/api/integrations",
    `/api/trips/memberships?${ids}`,
    // Trips.
    `/api/trips/${tripId}`,
    "/api/trips/needs-trip",
  ];
  const failures = [];
  for (const p of paths) {
    const res = await get(p);
    if (res.status !== 200) failures.push(`${p} -> ${res.status}`);
  }
  assert.deepEqual(failures, []);
});

test("exportDatabase returns sqlite bytes", () => {
  const bytes = sqljsDb.exportDatabase();
  assert.equal(new TextDecoder().decode(bytes.slice(0, 15)), "SQLite format 3");
});
