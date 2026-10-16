// The PC half of scripts/test-phone-sync-e2e.mjs, run as a child process.
//
// The desktop modules read the database from globalThis._db, and so do the
// phone's (sql.js loads into the same slot). Running the PC in its own process
// keeps its better-sqlite3 handle, encryption key and phone sync state apart
// from the phone's, as they are on real hardware. Not a test file: the test
// forks it and sends it commands over IPC.
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  createTempDataDir,
  registerSrcAliases,
  seedSyntheticWorkspace,
  withFixedNow,
} from "./phone-sync-test-helpers.mjs";

registerSrcAliases();
const dataDir = createTempDataDir("spent-phone-e2e-pc-");
// encryption.ts keeps its key under <cwd>/data: never in the checkout.
process.chdir(dataDir);
const tmpDir = path.join(dataDir, "os-tmp");
mkdirSync(tmpDir);
process.env.TMPDIR = process.env.TEMP = process.env.TMP = tmpDir;

const { getDb } = await import("../src/server/db/index.ts");
const settings = await import("../src/server/phone-sync/settings.ts");
const engine = await import("../src/server/phone-sync/engine.ts");
const { listDevices } = await import("../src/server/phone-sync/devices.ts");
const { normalizeMerchant } = await import("../src/server/lib/merchant-normalization.ts");
const { getHomeHandler } = await import("../src/server/api-handlers/home.ts");
const { getSummaryHandler } = await import("../src/server/api-handlers/summary.ts");
const { getTransactionsSummaryHandler } = await import(
  "../src/server/api-handlers/transactions.ts"
);
const transactionRoute = await import("../src/app/api/transactions/[id]/route.ts");
const { batchUpdateCategories, batchSetNeedsReview } = await import(
  "../src/server/db/queries/transactions.ts"
);

const HANDLERS = {
  "/api/home": getHomeHandler,
  "/api/summary": getSummaryHandler,
  "/api/transactions/summary": getTransactionsSummaryHandler,
};

const db = getDb();
let workspaceId = null;

const commands = {
  async init({ passphrase, folder }) {
    const seeded = await seedSyntheticWorkspace(db);
    workspaceId = seeded.workspaceId;
    settings.setPhoneSyncPassphrase(passphrase);
    settings.setPhoneSyncConfig({ enabled: true, folder });
    // Completed expense rows with a merchant memory key, one per merchant,
    // that the user has not decided yet: the rows the phone recategorizes.
    const editable = db
      .prepare(
        `SELECT id, description FROM transactions
         WHERE workspace_id = ? AND kind = 'expense' AND status = 'completed'
           AND (category_source IS NULL OR category_source <> 'user')
         ORDER BY id`
      )
      .all(workspaceId);
    const seen = new Set();
    const candidates = [];
    for (const row of editable) {
      const key = normalizeMerchant(row.description);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      candidates.push(row.id);
    }
    return { ...seeded, candidates };
  },
  sync: () => engine.runPhoneSync(),
  status: () => engine.getPhoneSyncStatus(),
  devices: () => listDevices(),
  setPassphrase: ({ passphrase }) => settings.setPhoneSyncPassphrase(passphrase),
  /** Calls a desktop API handler with a fixed clock, the way the phone router does. */
  handler: ({ path: route, query, now }) =>
    withFixedNow(now, () =>
      HANDLERS[route]({
        workspaceId,
        query: new URLSearchParams(query),
        params: {},
        now: new Date(),
        nextScheduledSync: null,
      })
    ),
  row: ({ id }) =>
    db
      .prepare(
        `SELECT id, category_id, category_source, category_decided_at, needs_review, description
         FROM transactions WHERE id = ?`
      )
      .get(id),
  merchant: ({ description }) =>
    db
      .prepare(
        `SELECT category_id, source FROM merchant_categories
         WHERE workspace_id = ? AND merchant_key = ?`
      )
      .get(workspaceId, normalizeMerchant(description)) ?? null,
  /** The desktop Transactions page recategorize, through its real route. */
  async recategorize({ id, categoryId }) {
    const res = await transactionRoute.PUT(
      new Request(`http://127.0.0.1/api/transactions/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-workspace-id": String(workspaceId) },
        body: JSON.stringify({ categoryId }),
      }),
      { params: Promise.resolve({ id: String(id) }) }
    );
    return { status: res.status, body: await res.json() };
  },
  /** An AI pass sets the category and flags the row for review (not a user decision). */
  aiCategorize({ id, categoryId }) {
    batchUpdateCategories(workspaceId, [{ id, categoryId, aiConfidence: 40 }]);
    batchSetNeedsReview(workspaceId, [{ id, needsReview: true }]);
    return null;
  },
  stop() {
    engine.stopPhoneSync();
    db.close();
    globalThis._db = undefined;
    return null;
  },
};

process.on("message", async ({ id, command, args }) => {
  try {
    const result = await commands[command](args ?? {});
    process.send({ id, ok: true, result: result ?? null });
  } catch (error) {
    process.send({ id, ok: false, error: error instanceof Error ? error.stack : String(error) });
  }
});
process.send({ ready: true, dataDir });
