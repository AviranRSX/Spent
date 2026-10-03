import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
  mergeSignedTransferSeries,
  mergeTransferIncomeIntoExpenseRows,
} from "../src/server/lib/summary-categories.ts";
import {
  combineTransactionPageSummaryTotals,
  combineTransactionSummaryTotals,
} from "../src/server/lib/transaction-summary.ts";

const tmpRoot = path.join(process.cwd(), ".tmp-tests");
mkdirSync(tmpRoot, { recursive: true });
const dataDir = mkdtempSync(path.join(tmpRoot, "spent-income-transfers-"));
const dbPath = path.join(dataDir, "spent.db");

function runSqlMigrations(db) {
  const migrationsDir = path.join(
    process.cwd(),
    "src",
    "server",
    "db",
    "migrations"
  );
  for (const file of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    db.pragma("foreign_keys = OFF");
    db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
    db.pragma("foreign_keys = ON");
  }
}

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
runSqlMigrations(db);

test.after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(tmpRoot, { recursive: true, force: true });
});

test("migrations seed Transfers as both expense and income categories", () => {
  const rows = db
    .prepare(
      `SELECT name, kind, description
       FROM categories
       WHERE workspace_id = 1 AND name = 'Transfers'
       ORDER BY kind`
    )
    .all();

  assert.deepEqual(
    rows.map((row) => row.kind),
    ["expense", "income"]
  );
  assert.match(rows[1].description, /money received and money sent/i);
});

test("category uniqueness allows the same name in different kinds only", () => {
  assert.doesNotThrow(() => {
    db.prepare(
      `INSERT INTO categories (workspace_id, name, color, icon, kind)
       VALUES (1, 'Mirror Name', '#111111', 'arrow-left-right', 'expense')`
    ).run();
    db.prepare(
      `INSERT INTO categories (workspace_id, name, color, icon, kind)
       VALUES (1, 'Mirror Name', '#222222', 'arrow-left-right', 'income')`
    ).run();
  });

  assert.throws(() => {
    db.prepare(
      `INSERT INTO categories (workspace_id, name, color, icon, kind)
       VALUES (1, 'Mirror Name', '#333333', 'arrow-left-right', 'income')`
    ).run();
  }, /UNIQUE/);
});

test("budget summary nets income Transfers against expense Transfers", () => {
  const rows = mergeTransferIncomeIntoExpenseRows(
    [
      {
        categoryId: 1,
        parentId: null,
        parentName: null,
        isParent: false,
        budgetSource: "leaf",
        categoryName: "Transfers",
        categoryColor: "#A2AAC2",
        categoryIcon: "arrow-left-right",
        budgetMode: "tracking",
        spent: 120,
        transactionCount: 1,
        topMerchant: "Outgoing transfer",
        budget: 0,
        isAutoBudget: false,
        vsLastMonth: null,
        remaining: 0,
        perDayRemaining: null,
        percentSpent: 0,
        status: "on-track",
        needsReviewCount: 0,
        vsTypical: null,
      },
    ],
    {
      amount: 80,
      count: 2,
      needsReviewCount: 1,
      previousAmount: 30,
    },
    50
  );

  assert.equal(rows[0].spent, 40);
  assert.equal(rows[0].transactionCount, 3);
  assert.equal(rows[0].needsReviewCount, 1);
  assert.equal(rows[0].vsLastMonth, 100);
});

test("transfer detail daily series treats income as negative", () => {
  const merged = mergeSignedTransferSeries(
    [
      { date: "2026-05-01", amount: 120 },
      { date: "2026-05-03", amount: 40 },
    ],
    [
      { date: "2026-05-01", amount: 80 },
      { date: "2026-05-02", amount: 25 },
    ]
  );

  assert.deepEqual(merged, [
    { date: "2026-05-01", amount: 40 },
    { date: "2026-05-02", amount: -25 },
    { date: "2026-05-03", amount: 40 },
  ]);
});

test("transaction summary treats transfer rows as expenses when requested", () => {
  const summary = combineTransactionSummaryTotals({
    income: { total: 10000, count: 1 },
    expense: { total: 3000, count: 3 },
    expenseTransfers: { total: 4500, count: 2 },
  });

  assert.deepEqual(summary.expense, { total: 7500, count: 5 });
  assert.equal(summary.net, 2500);
});

test("transaction page summary excludes transfers from cash-flow totals", () => {
  const summary = combineTransactionPageSummaryTotals({
    income: { total: 10000, count: 1 },
    expense: { total: 3000, count: 3 },
    transfers: { total: 4500, count: 2 },
  });

  assert.deepEqual(summary.income, { total: 10000, count: 1 });
  assert.deepEqual(summary.expense, { total: 3000, count: 3 });
  assert.equal(summary.net, 7000);
});

test("migration 024 reclassifies plural credit card payments as transfers", () => {
  const migrationsDir = path.join(process.cwd(), "src", "server", "db", "migrations");
  const files = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
  const scratch = new Database(path.join(dataDir, "migration-024.db"));
  try {
    for (const file of files.filter((name) => name < "024")) {
      scratch.pragma("foreign_keys = OFF");
      scratch.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
      scratch.pragma("foreign_keys = ON");
    }
    const runId = scratch
      .prepare(
        `INSERT INTO sync_runs (workspace_id, provider, started_at, status, scrape_from_date)
         VALUES (1, 'leumi_bank_account', '2026-08-01', 'completed', '2026-08-01')`
      )
      .run().lastInsertRowid;
    const insert = scratch.prepare(
      `INSERT INTO transactions (workspace_id, account_number, date, processed_date,
         original_amount, original_currency, charged_amount, description, type, status,
         provider, sync_run_id, dedup_hash, kind)
       VALUES (1, '000', '2026-08-02', '2026-08-02', ?, 'ILS', ?, ?, 'normal', 'completed',
         ?, ?, ?, 'expense')`
    );
    insert.run(-480, -480, "כרטיסי אשראי לדוגמה", "leumi_bank_account", runId, "h1");
    insert.run(-60, -60, "כרטיסי אשראי לדוגמה", "isracard_bill", runId, "h2");

    scratch.exec(readFileSync(path.join(migrationsDir, "024_credit_card_payment_plural.sql"), "utf8"));

    const kinds = scratch
      .prepare("SELECT provider, kind FROM transactions ORDER BY provider")
      .all();
    assert.deepEqual(kinds, [
      { provider: "isracard_bill", kind: "expense" },
      { provider: "leumi_bank_account", kind: "transfer" },
    ]);
  } finally {
    scratch.close();
  }
});
