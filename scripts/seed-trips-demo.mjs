// Seeds a throwaway database with synthetic trip data for API smoke checks
// and browser checks. Never point this at data/.
//   npm run seed:trips-demo
//   SPENT_DATA_DIR=.tmp-tests/trips-demo npm run dev
import { mkdirSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

const dataDir = path.join(process.cwd(), ".tmp-tests", "trips-demo");
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });
process.env.SPENT_DATA_DIR = dataDir;

const { getDb } = await import("../src/server/db/index.ts");
const { setDataSourceMode } = await import("../src/server/db/queries/settings.ts");
const { getCategoryByName } = await import("../src/server/db/queries/categories.ts");
const { createTrip } = await import("../src/server/db/queries/trips.ts");

const db = getDb();
const workspaceId = 1;
setDataSourceMode(workspaceId, "xlsx");

const syncRunId = Number(
  db
    .prepare(
      `INSERT INTO sync_runs (workspace_id, provider, started_at, status, scrape_from_date)
       VALUES (?, 'max_bill', '2026-01-01', 'completed', '2026-01-01')`
    )
    .run(workspaceId).lastInsertRowid
);
const insert = db.prepare(
  `INSERT INTO transactions
     (workspace_id, account_number, date, processed_date, original_amount,
      original_currency, charged_amount, charged_currency, description, type,
      status, provider, sync_run_id, dedup_hash, kind, category_id, category_source)
   VALUES (@workspaceId, 'demo-card', @date, @date, @originalAmount, @currency,
           @chargedAmount, 'ILS', @description, 'normal', @status, 'max_bill',
           @syncRunId, @hash, 'expense', @categoryId, @categorySource)`
);
let n = 0;
function add(date, currency, originalAmount, chargedAmount, description, categoryName, status = "completed") {
  const categoryId = categoryName
    ? getCategoryByName(workspaceId, categoryName, "expense")?.id ?? null
    : null;
  insert.run({
    workspaceId, date, currency, originalAmount, chargedAmount, description, status,
    syncRunId, hash: `demo-${n++}`, categoryId, categorySource: categoryId ? "ai" : null,
  });
}

// Short trip abroad in CZK with one EUR exchange and local app charges.
// Left unconfirmed so the Trips page detects it as a suggestion.
add("2026-02-20", "Kč", -5400, -828.0, "Demo Hotel Praha", "Travel");
add("2026-04-10", "Kč", -850, -130.5, "Demo Kavarna", "Travel");
add("2026-04-10", "Kč", -420, -64.2, "Demo Potraviny", "Travel");
add("2026-04-11", "Kč", -60, -9.2, "Demo Metro", "Travel");
add("2026-04-12", "€", -50, -198.0, "Demo Exchange", "Cash & ATM");
add("2026-04-12", "ILS", -35, -35, "Demo Ride App", "Transport");
add("2026-04-13", "Kč", -1200, -184.1, "Demo Bistro", "Restaurants");

// Long-haul trip in JPY: USD flight weeks before, prepaid hotels, USD tour.
add("2026-06-20", "$", -1450, -5400, "Demo Airways", "Flights");
add("2026-04-05", "¥", -48000, -1210, "Demo Ryokan", "Travel");
add("2026-05-14", "¥", -36000, -905, "Demo Business Hotel", "Travel");
add("2026-08-02", "¥", -3200, -80.4, "Demo Ramen", "Restaurants");
add("2026-08-03", "¥", -5400, -135.7, "Demo Konbini", "Groceries");
add("2026-08-04", "$", -120, -447, "Demo City Tour", "Travel");
add("2026-08-05", "¥", -8800, -221.2, "Demo Department Store", "Shopping");
add("2026-08-06", "¥", -2100, -52.8, "Demo Cafe", "Coffee & Cafes", "pending");

// Monthly online purchases that must never look like trips.
for (const month of ["01", "02", "03", "04", "05", "06", "07", "08", "09"]) {
  add(`2026-${month}-07`, "$", -19.99, -74.5, "SHEIN.COM DEMO", "Shopping");
  add(`2026-${month}-08`, "$", -20, -74.6, "SPOTIFY *DEMO", "Subscriptions");
  add(`2026-${month}-09`, "€", -12.5, -50.1, "EBAY *DEMOSELLER", "Shopping");
}

// A local weekend away, assigned by multi-select in the UI.
add("2026-05-01", "ILS", -890, -890, "Demo Zimmer Galil", "Travel");
add("2026-05-02", "ILS", -240, -240, "Demo Galil Restaurant", "Restaurants");

createTrip(workspaceId, {
  name: "Japan Aug 2026",
  country: "Japan",
  currency: "JPY",
  startDate: "2026-08-01",
  endDate: "2026-08-10",
});

globalThis._db?.close();
console.log(`Seeded synthetic trip demo data in ${dataDir}`);
