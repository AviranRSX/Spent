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
const dataDir = createTempDataDir("spent-phone-sqljs-");

test.after(() => {
  globalThis._db?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const { createSqlJsDatabase } = await import("../src/mobile/db/sqljs-adapter.ts");
const { getDb } = await import("../src/server/db/index.ts");

const empty = () => createSqlJsDatabase(new Uint8Array());

test("positional params", async () => {
  const db = await empty();
  assert.deepEqual(db.prepare("SELECT ? AS a, ? AS b").get(1, "x"), { a: 1, b: "x" });
});

test("named params", async () => {
  const db = await empty();
  assert.deepEqual(db.prepare("SELECT @a AS a").get({ a: 5 }), { a: 5 });
});

test("array spread params", async () => {
  const db = await empty();
  const params = [1, 2];
  assert.deepEqual(db.prepare("SELECT ? AS a, ? AS b").all(...params), [{ a: 1, b: 2 }]);
});

test("run reports changes", async () => {
  const db = await empty();
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  const ins = db.prepare("INSERT INTO t (v) VALUES (?)");
  const first = ins.run("a");
  const second = ins.run("b");
  assert.equal(first.changes, 1);
  assert.equal(second.changes, 1);
  assert.equal(second.lastInsertRowid, first.lastInsertRowid + 1);
});

test("transaction rolls back on throw", async () => {
  const db = await empty();
  db.exec("CREATE TABLE t (v TEXT)");
  assert.throws(
    db.transaction(() => {
      db.prepare("INSERT INTO t (v) VALUES (?)").run("a");
      throw new Error("boom");
    }),
    /boom/
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM t").get().n, 0);
});

test("nested transaction rolls back only the inner savepoint", async () => {
  const db = await empty();
  db.exec("CREATE TABLE t (v TEXT)");
  const insert = (v) => db.prepare("INSERT INTO t (v) VALUES (?)").run(v);
  db.transaction(() => {
    insert("outer");
    assert.throws(
      db.transaction(() => {
        insert("inner");
        throw new Error("inner fail");
      })
    );
  })();
  assert.deepEqual(db.prepare("SELECT v FROM t").all(), [{ v: "outer" }]);
});

test("pragma", async () => {
  const db = await empty();
  assert.ok(Array.isArray(db.pragma("foreign_keys")));
});

test("parity with better-sqlite3", async () => {
  const native = getDb();
  const { workspaceId } = await seedSyntheticWorkspace(native);
  const file = path.join(dataDir, "copy.db");
  native.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  const phone = await createSqlJsDatabase(new Uint8Array(readFileSync(file)));

  const queries = [
    [
      "SELECT id, description, charged_amount, kind, status FROM transactions WHERE workspace_id = ? ORDER BY id",
      [workspaceId],
    ],
    [
      "SELECT strftime('%Y-%m', date) AS month, SUM(ABS(charged_amount)) AS amount FROM transactions WHERE workspace_id = ? AND status = 'completed' AND kind = 'expense' GROUP BY month ORDER BY month",
      [workspaceId],
    ],
    [
      "SELECT t.id, c.name AS category FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE t.workspace_id = ? AND t.description LIKE ? ORDER BY t.id",
      [workspaceId, "%a%"],
    ],
    [
      "SELECT COUNT(*) AS n FROM transactions WHERE workspace_id = ? AND needs_review = 1",
      [workspaceId],
    ],
    [
      "SELECT id, name, parent_id, kind FROM categories WHERE workspace_id = ? ORDER BY name, id",
      [workspaceId],
    ],
    ["SELECT * FROM trips WHERE workspace_id = ? AND status = 'confirmed'", [workspaceId]],
  ];
  for (const [sql, params] of queries) {
    assert.deepEqual(phone.prepare(sql).all(...params), native.prepare(sql).all(...params), sql);
    assert.deepEqual(phone.prepare(sql).get(...params), native.prepare(sql).get(...params), sql);
  }
  assert.ok(phone.prepare(queries[0][0]).all(workspaceId).length > 10);
  assert.equal(phone.prepare(queries[3][0]).get(workspaceId).n, 1);
});
