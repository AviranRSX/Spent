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

test("exportDatabase returns sqlite bytes", () => {
  const bytes = sqljsDb.exportDatabase();
  assert.equal(new TextDecoder().decode(bytes.slice(0, 15)), "SQLite format 3");
});
