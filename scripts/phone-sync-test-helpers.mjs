import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function withTsExtension(target) {
  if (path.extname(target) !== "") return target;
  if (existsSync(`${target}.ts`)) return `${target}.ts`;
  if (existsSync(path.join(target, "index.ts"))) return path.join(target, "index.ts");
  return `${target}.ts`;
}

/** Same `@/` and extensionless relative resolve hooks as scripts/test-trips-db.mjs. */
export function registerSrcAliases() {
  const srcRoot = path.join(process.cwd(), "src");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@/")) {
        const target = path.join(srcRoot, specifier.slice(2));
        return nextResolve(pathToFileURL(withTsExtension(target)).href, context);
      }
      // Lets tests import route.ts files, which pull in next/server.
      if (specifier === "next/server") {
        return nextResolve("next/server.js", context);
      }
      if (
        specifier.startsWith(".") &&
        path.extname(specifier) === "" &&
        context.parentURL?.includes("/src/") &&
        !context.parentURL.includes("/node_modules/")
      ) {
        const target = path.resolve(
          path.dirname(fileURLToPath(context.parentURL)),
          specifier
        );
        return nextResolve(pathToFileURL(withTsExtension(target)).href, context);
      }
      return nextResolve(specifier, context);
    },
  });
}

/** Creates a temp dir under .tmp-tests/ and points SPENT_DATA_DIR at it. */
export function createTempDataDir(prefix) {
  const tmpRoot = path.join(process.cwd(), ".tmp-tests");
  mkdirSync(tmpRoot, { recursive: true });
  const dir = mkdtempSync(path.join(tmpRoot, prefix));
  process.env.SPENT_DATA_DIR = dir;
  return dir;
}

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function row(account, date, amount, description, extra = {}) {
  return {
    accountNumber: account,
    date,
    processedDate: date,
    originalAmount: amount,
    originalCurrency: "ILS",
    chargedAmount: amount,
    chargedCurrency: "ILS",
    description,
    type: "normal",
    status: "completed",
    ...extra,
  };
}

/**
 * Seeds a fresh workspace with invented rows. `db` must be the handle returned
 * by getDb() (the query helpers use the same singleton).
 */
export async function seedSyntheticWorkspace(db) {
  const { createWorkspace } = await import("../src/server/db/queries/workspaces.ts");
  const { insertTransactions, updateTransactionCategory } = await import(
    "../src/server/db/queries/transactions.ts"
  );
  const { transactions: fake } = await import("./docs-seed/fake-data.mjs");

  const workspaceId = createWorkspace("Synthetic Home").id;

  const categoryIds = {};
  for (const r of db
    .prepare("SELECT id, name FROM categories WHERE workspace_id = ? AND kind = 'expense'")
    .all(workspaceId)) {
    categoryIds[r.name] = r.id;
  }
  const salary = db
    .prepare(
      "SELECT id FROM categories WHERE workspace_id = ? AND kind = 'income' AND name = 'Salary'"
    )
    .get(workspaceId);
  if (salary) categoryIds.Salary = salary.id;

  const syncRunId = Number(
    db
      .prepare(
        `INSERT INTO sync_runs (workspace_id, provider, started_at, completed_at, status, scrape_from_date)
         VALUES (?, 'import', datetime('now'), datetime('now'), 'completed', '2000-01-01')`
      )
      .run(workspaceId).lastInsertRowid
  );

  const providerMap = {
    isracard: { provider: "isracard_bill", account: "1111" },
    max: { provider: "max_bill", account: "2222" },
    hapoalim: { provider: "hapoalim_bank_account", account: "333-444" },
  };
  const byProvider = new Map();
  for (const t of fake) {
    const mapped = providerMap[t.provider];
    const list = byProvider.get(mapped.provider) ?? [];
    list.push(row(mapped.account, t.date, t.amount, t.merchant));
    byProvider.set(mapped.provider, list);
  }

  // Extra rows: a pending card row, an outgoing transfer, a foreign-currency trip purchase.
  byProvider
    .get("max_bill")
    .push(row("2222", isoDaysAgo(0), -55, "Pending Cafe", { status: "pending" }));
  byProvider
    .get("hapoalim_bank_account")
    .push(row("333-444", isoDaysAgo(12), -1500, "Transfer To Savings"));
  byProvider.get("isracard_bill").push(
    row("1111", isoDaysAgo(22), -95, "Sample Bistro Paris", {
      originalCurrency: "EUR",
      chargedAmount: -380,
    })
  );

  for (const [provider, rows] of byProvider) {
    insertTransactions(workspaceId, rows, provider, null, syncRunId);
  }

  const idByDescription = (description) =>
    db
      .prepare("SELECT id FROM transactions WHERE workspace_id = ? AND description = ?")
      .get(workspaceId, description).id;

  for (const r of db
    .prepare(
      "SELECT id FROM transactions WHERE workspace_id = ? AND description LIKE 'Shufersal%'"
    )
    .all(workspaceId)) {
    updateTransactionCategory(workspaceId, r.id, categoryIds.Groceries, "user");
  }

  // AI-categorized row flagged for review.
  const aiId = idByDescription("Wolt · Pizza Domino");
  updateTransactionCategory(workspaceId, aiId, categoryIds.Restaurants, "ai");
  db.prepare("UPDATE transactions SET needs_review = 1, ai_confidence = 40 WHERE id = ?").run(aiId);

  // Transfers row.
  const transferId = idByDescription("Transfer To Savings");
  updateTransactionCategory(workspaceId, transferId, categoryIds.Transfers, "user");
  db.prepare("UPDATE transactions SET kind = 'transfer' WHERE id = ?").run(transferId);

  // Confirmed trip covering the foreign-currency row.
  const tripId = Number(
    db
      .prepare(
        `INSERT INTO trips (workspace_id, name, country, currency, start_date, end_date, status)
         VALUES (?, 'Sample Paris Trip', 'FR', 'EUR', ?, ?, 'confirmed')`
      )
      .run(workspaceId, isoDaysAgo(24), isoDaysAgo(20)).lastInsertRowid
  );
  db.prepare(
    "INSERT INTO trip_assignments (transaction_id, workspace_id, trip_id) VALUES (?, ?, ?)"
  ).run(idByDescription("Sample Bistro Paris"), workspaceId, tripId);

  const transactionIds = db
    .prepare("SELECT id FROM transactions WHERE workspace_id = ? ORDER BY id")
    .all(workspaceId)
    .map((r) => r.id);

  return { workspaceId, categoryIds, transactionIds };
}

/**
 * Runs `fn` with `new Date()` and `Date.now()` pinned to `iso`, so handlers
 * that read the clock give the same answer in two processes.
 */
export async function withFixedNow(iso, fn) {
  const RealDate = globalThis.Date;
  const fixed = new RealDate(iso).getTime();
  class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }
    static now() {
      return fixed;
    }
  }
  globalThis.Date = FixedDate;
  try {
    return await fn();
  } finally {
    globalThis.Date = RealDate;
  }
}
