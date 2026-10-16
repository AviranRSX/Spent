// Creates (or recreates) a "Demo" workspace filled with an invented
// household: one bank account, three credit cards, about 14 months of
// history, budgets and trips. Every row is synthetic. Use it to show Spent
// to other people without opening a real workspace.
//
//   npm run seed:demo                               # adds Demo to data/spent.db
//   SPENT_DATA_DIR=.demo-data npm run seed:demo     # a separate demo-only database
//   SPENT_DATA_DIR=.demo-data npm run dev           # run the app on that database
//
// Rerunning replaces the previous Demo workspace. Other workspaces are never
// touched. Before writing to an existing database, a backup is saved to
// <data dir>/backups/.
import { existsSync, mkdirSync } from "node:fs";
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

const DEMO_NAME = "Demo";
const DEMO_MARKER = "demo_workspace";
const MONTHS_OF_HISTORY = 13;

const dataDir = process.env.SPENT_DATA_DIR
  ? path.resolve(process.env.SPENT_DATA_DIR)
  : path.join(process.cwd(), "data");
const dbExisted = existsSync(path.join(dataDir, "spent.db"));

const { getDb } = await import("../src/server/db/index.ts");
const { setWorkspaceSetting, setDataSourceMode, updateAppSettings } = await import(
  "../src/server/db/queries/settings.ts"
);
const { createWorkspace, deleteWorkspace } = await import(
  "../src/server/db/queries/workspaces.ts"
);
const { getCategoryByName, SEEDED_CATEGORY_PARENTS } = await import(
  "../src/server/db/queries/categories.ts"
);
const { setBudget } = await import("../src/server/db/queries/budgets.ts");
const { insertTransactions } = await import("../src/server/db/queries/transactions.ts");
const { createSyncRun, completeSyncRun } = await import(
  "../src/server/db/queries/sync-runs.ts"
);
const { createImportSource } = await import("../src/server/db/queries/import-sources.ts");
const { createTrip } = await import("../src/server/db/queries/trips.ts");
const { detectTripSuggestions } = await import("../src/server/trips/detection.ts");

const db = getDb();

if (dbExisted) {
  const backupDir = path.join(dataDir, "backups");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);
  const backupPath = path.join(backupDir, `spent-pre-demo-${stamp}.db`);
  await db.backup(backupPath);
  console.log(`Backed up the database to ${backupPath}`);
}

// ---------------------------------------------------------------------------
// Deterministic randomness, so reruns on the same day give the same data.

let seed = 20240917;
function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (min, max) => Math.round((min + rand() * (max - min)) * 100) / 100;
const intBetween = (min, max) => Math.floor(min + rand() * (max - min + 1));
const chance = (p) => rand() < p;
const pick = (items) => items[Math.floor(rand() * items.length)];

const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();

const now = new Date();
const todayIso = iso(now.getFullYear(), now.getMonth(), now.getDate());

// ---------------------------------------------------------------------------
// Accounts. Numbers are obviously fake on purpose.

const SOURCES = {
  bank: { provider: "hapoalim_bank_account", kind: "bank", label: "Demo checking", account: "12-600-000000" },
  isracard: { provider: "isracard_bill", kind: "card", label: "Demo Isracard 1111", account: "1111" },
  cal: { provider: "cal_bill", kind: "card", label: "Demo CAL 2222", account: "2222" },
  max: { provider: "max_bill", kind: "card", label: "Demo Max 3333", account: "3333" },
};

// Card bills are debited from the bank on these days of the following month.
const CARD_BILL = {
  isracard: { day: 2, description: "ישראכרט חיוב חודשי" },
  cal: { day: 10, description: "כאל חיוב כרטיס" },
  max: { day: 15, description: "מקס חיוב כרטיס דמו" },
};

const rows = { bank: [], isracard: [], cal: [], max: [] };
// description -> category name. Each description maps to one category.
const categoryOf = new Map();

const FX = { "€": 4.02, "$": 3.71, "£": 4.78 };

function add(source, date, description, amount, category, extra = {}) {
  if (date > todayIso) return;
  const { currency, installment } = extra;
  const charged = currency ? Math.round(amount * FX[currency] * 100) / 100 : amount;
  const original = installment ? installment.original : amount;
  const isCard = source !== "bank";
  const ageDays = (Date.parse(todayIso) - Date.parse(date)) / 86_400_000;
  rows[source].push({
    accountNumber: SOURCES[source].account,
    date,
    processedDate: date,
    originalAmount: original,
    originalCurrency: currency ?? "ILS",
    chargedAmount: charged,
    chargedCurrency: "ILS",
    description,
    type: installment ? "installments" : "normal",
    status: isCard && ageDays < 3 ? "pending" : "completed",
    installmentNumber: installment?.number,
    installmentTotal: installment?.total,
  });
  if (category) categoryOf.set(description, category);
}

// ---------------------------------------------------------------------------
// One month of household life.

function seedMonth(y, m, monthIndex) {
  const dim = daysIn(y, m);
  const day = (d) => iso(y, m, Math.min(d, dim));
  const anyDay = () => day(intBetween(1, dim));
  const calendarMonth = m + 1;
  const summer = calendarMonth >= 7 && calendarMonth <= 9;
  const winter = calendarMonth === 12 || calendarMonth <= 2;

  // Bank: income
  const raise = y > 2025 || (y === 2025 && calendarMonth >= 12);
  add("bank", day(10), "משכורת אקמה טכנולוגיות", raise ? 17620 : 16850, "Salary");
  add("bank", day(9), "משכורת נוגה חינוך", 11240, "Salary");
  if (calendarMonth === 3) add("bank", day(10), "מענק שנתי אקמה טכנולוגיות", 8000, "Salary");
  if (monthIndex % 3 === 1) {
    add("bank", day(intBetween(20, 27)), "העברה מלקוח סטודיו דמו", between(1800, 3600), "Freelance & Side Income");
  }
  if ([3, 6, 9, 12].includes(calendarMonth)) {
    add("bank", day(28), "דיבידנד ניירות ערך", between(180, 320), "Investment Income");
  }
  if (calendarMonth === 4) add("bank", day(21), "החזר מס הכנסה", 2140, "Refunds & Reimbursements");
  if (chance(0.45)) add("bank", anyDay(), "העברה ב-BIT התקבלה", between(100, 400), "Transfers");

  // Bank: fixed expenses
  add("bank", day(1), "שכר דירה בעל הבית דמו", -6200, "Rent");
  add("bank", day(1), "ועד בית", -250, "Bills & Utilities");
  if (calendarMonth === 8) {
    add("bank", day(3), "קייטנת קיץ דמו", -1850, "Kids & Childcare");
  } else {
    add("bank", day(3), "פעוטון גן השקמה", -3100, "Kids & Childcare");
  }
  add("bank", day(5), "הראל ביטוח בריאות", -312.4, "Insurance");
  if (calendarMonth % 2 === 1) {
    add("bank", day(15), "חברת החשמל לישראל", -between(380, 460) - (summer ? 290 : 0) - (winter ? 170 : 0), "Bills & Utilities");
    add("bank", day(18), "עיריית תל אביב ארנונה", -1164, "Bills & Utilities");
    add("bank", day(22), "מי אביבים", -between(160, 230), "Bills & Utilities");
  }
  if (chance(0.8)) add("bank", day(12), "כספומט דמו משיכה", -pick([200, 300, 400, 500]), "Cash & ATM");
  if (chance(0.6)) add("bank", anyDay(), "העברה ב-BIT", -between(80, 300), "Transfers");
  if (calendarMonth === 9) add("bank", day(20), "תרומה לעמותת דמו", -360, "Gifts & Donations");

  // Isracard: the main family card
  for (let d = 2; d <= dim; d += 7) {
    add("isracard", day(d), "שופרסל דיל", -between(380, 720), "Groceries");
  }
  for (let i = intBetween(7, 12); i > 0; i--) {
    add("isracard", anyDay(), pick(["ארומה", "קפה גרג", "לחמים"]), -between(16, 42), "Coffee & Cafes");
  }
  for (let i = intBetween(2, 3); i > 0; i--) {
    add("isracard", anyDay(), pick(["פז תחנת דלק", "דלק מוטורס"]), -between(220, 330), "Transport");
  }
  for (let i = intBetween(2, 4); i > 0; i--) {
    add("isracard", anyDay(), "וולט", -between(85, 195), "Restaurants");
  }
  if (chance(0.7)) add("isracard", anyDay(), "מסעדת השולחן הכתום", -between(240, 430), "Restaurants");
  if (chance(0.75)) add("isracard", anyDay(), "סופר-פארם", -between(45, 190), "Health");
  if (chance(0.2)) add("isracard", anyDay(), "מרפאת שיניים דמו", -between(280, 650), "Health");
  if (calendarMonth === 2) add("isracard", day(8), "ביטוח רכב דמו", -3480, "Insurance");
  if (monthIndex === 5) add("isracard", day(17), "מוסך הצפון", -2850, "Transport");

  // CAL: subscriptions, bills and shopping
  add("cal", day(1), "הולמס פלייס", -289, "Sports & Hobbies");
  add("cal", day(6), "NETFLIX.COM", -54.9, "Subscriptions");
  add("cal", day(8), "SPOTIFY", -11.99, "Subscriptions", { currency: "$" });
  add("cal", day(12), "APPLE.COM/BILL", -11.9, "Subscriptions");
  add("cal", day(14), "פרטנר תקשורת", -99, "Bills & Utilities");
  add("cal", day(14), "בזק בינלאומי", -129, "Bills & Utilities");
  for (let i = intBetween(1, 3); i > 0; i--) {
    add("cal", anyDay(), pick(["זארה", "H&M", "קסטרו", "KSP", "פוקס"]), -between(110, 520), "Shopping");
  }
  if (chance(0.5)) add("cal", anyDay(), pick(["ACE", "הום סנטר"]), -between(60, 340), "Home");
  add("cal", day(intBetween(3, 26)), "חיות ושות", -between(140, 230), "Pet Care");
  if (chance(0.15)) add("cal", anyDay(), "וטרינר דמו", -380, "Pet Care");
  if (chance(0.35)) add("cal", anyDay(), "PAYPAL *DEMOSHOP", -between(8, 45), "Shopping", { currency: "$" });

  // Max: the second card
  for (let d = 5; d <= dim; d += 7) {
    add("max", day(d), "רמי לוי שיווק השקמה", -between(160, 420), "Groceries");
  }
  for (let i = intBetween(3, 6); i > 0; i--) {
    add("max", anyDay(), "קפה קפה", -between(18, 46), "Coffee & Cafes");
  }
  add("max", day(intBetween(5, 25)), "מספרת דמו", -between(90, 260), "Personal Care");
  if (chance(0.6)) add("max", anyDay(), "שילב", -between(80, 300), "Kids & Childcare");
  if (chance(0.5)) add("max", anyDay(), "סינמה סיטי", -between(90, 180), "Entertainment");
  add("max", day(3), "רב-קו טעינה", -100, "Transport");
  for (let i = intBetween(2, 4); i > 0; i--) {
    add("max", anyDay(), "פנגו חניה", -between(8, 32), "Transport");
  }
  add("max", day(4), "חוג רובוטיקה דמו", -220, "Education");
  if (calendarMonth === 8) add("max", day(25), "סטימצקי ספרי לימוד", -480, "Education");
  if (chance(0.3)) add("max", anyDay(), "פרחי דמו", -between(90, 220), "Gifts & Donations");
}

// ---------------------------------------------------------------------------
// Build the timeline.

const months = [];
for (let back = MONTHS_OF_HISTORY; back >= 0; back--) {
  const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
  months.push({ y: d.getFullYear(), m: d.getMonth() });
}
months.forEach(({ y, m }, i) => seedMonth(y, m, i));

// A sofa on 12 installments, started eight months ago.
const sofa = months[months.length - 9];
for (let n = 1; n <= 12; n++) {
  const at = new Date(sofa.y, sofa.m + n - 1, 7);
  add("cal", iso(at.getFullYear(), at.getMonth(), 7), "איקאה נתניה", -450, "Home", {
    installment: { original: -5400, number: n, total: 12 },
  });
}

// Greece, four months ago: a confirmed trip.
const greece = months[months.length - 5];
const gDay = (d) => iso(greece.y, greece.m, d);
const flightDate = new Date(greece.y, greece.m - 2, 11);
add("isracard", iso(flightDate.getFullYear(), flightDate.getMonth(), 11), "ישראייר", -3960, "Flights");
add("isracard", gDay(7), "פספורטכארד ביטוח נסיעות", -290, "Travel Insurance");
add("cal", gDay(14), "BOOKING.COM HOTEL ATHENS", -1240, "Hotels", { currency: "€" });
add("cal", gDay(14), "HERTZ HELLAS", -210, "Travel", { currency: "€" });
add("isracard", gDay(15), "GETYOURGUIDE", -120, "Activities", { currency: "€" });
add("isracard", gDay(15), "ATM ATHENS", -100, "Cash & ATM", { currency: "€" });
for (const [d, name, amount] of [
  [14, "TAVERNA DEMO PLAKA", 64],
  [15, "SKLAVENITIS", 38.5],
  [16, "TAVERNA DEMO NAXOS", 92],
  [17, "SKLAVENITIS", 51.2],
  [18, "PSAROTAVERNA DEMO", 108],
  [19, "TAVERNA DEMO PLAKA", 47],
]) {
  add("isracard", gDay(d), name, -amount, name === "SKLAVENITIS" ? "Groceries" : "Restaurants", { currency: "€" });
}

// London, two months ago: left unconfirmed so Trips shows a suggestion.
const london = months[months.length - 3];
const lDay = (d) => iso(london.y, london.m, d);
add("max", lDay(3), "PRET A MANGER", -14.8, "Coffee & Cafes", { currency: "£" });
add("max", lDay(3), "TFL TRAVEL CH", -18.2, "Transport", { currency: "£" });
add("max", lDay(4), "DISHOOM", -76.5, "Restaurants", { currency: "£" });
add("max", lDay(5), "HAMLEYS", -42, "Kids & Childcare", { currency: "£" });
add("max", lDay(5), "PRET A MANGER", -11.4, "Coffee & Cafes", { currency: "£" });
add("max", lDay(6), "TFL TRAVEL CH", -12.6, "Transport", { currency: "£" });

// Card bills in the bank: last month's completed card spend, paid next month.
for (const card of ["isracard", "cal", "max"]) {
  for (const { y, m } of months) {
    const prefix = iso(y, m, 1).slice(0, 7);
    const total = rows[card]
      .filter((r) => r.status === "completed" && r.date.startsWith(prefix))
      .reduce((sum, r) => sum + r.chargedAmount, 0);
    if (total === 0) continue;
    const pay = new Date(y, m + 1, CARD_BILL[card].day);
    add("bank", iso(pay.getFullYear(), pay.getMonth(), pay.getDate()), CARD_BILL[card].description, Math.round(total * 100) / 100);
  }
}

// ---------------------------------------------------------------------------
// Write it.

const previous = db
  .prepare(
    `SELECT w.id FROM workspaces w
     JOIN workspace_settings s ON s.workspace_id = w.id
     WHERE s.key = ? AND s.value = 'true'`
  )
  .all(DEMO_MARKER)
  .map((r) => r.id);

const writeDemo = db.transaction(() => {
  const workspaceId = createWorkspace(DEMO_NAME).id;
  setWorkspaceSetting(workspaceId, DEMO_MARKER, "true");
  setDataSourceMode(workspaceId, "xlsx");
  updateAppSettings(workspaceId, { monthlyTarget: 21000, paydayDay: 10 });

  // New workspaces only get the Trips & Travel group. Add the other groups
  // that migrated workspaces have, so the demo shows the full hierarchy.
  const groups = {
    Food: ["#E7A875", "utensils-crossed", "Rollup of food spending: groceries, restaurants, cafes."],
    Transportation: ["#7D90CA", "tram-front", "Rollup of getting-around spending: daily commutes plus travel."],
    Lifestyle: ["#D692BF", "sparkles", "Rollup of discretionary spending: shopping, entertainment, personal care, hobbies."],
    "Home & Bills": ["#A4C386", "home", "Rollup of recurring home expenses: rent, bills, home upkeep, insurance, subscriptions."],
    "Health & Family": ["#65C1D1", "heart-pulse", "Rollup of health and family spending: medical, education, childcare, pets."],
    "Money Movement": ["#A2ABBB", "arrow-left-right", "Rollup of money-flow categories that aren't pure spending: ATM, transfers, gifts."],
  };
  const insertParent = db.prepare(
    `INSERT INTO categories (workspace_id, parent_id, name, color, icon, kind, budget_mode, description)
     VALUES (?, NULL, ?, ?, ?, 'expense', 'tracking', ?)`
  );
  const parentIds = {};
  for (const [name, [color, icon, description]] of Object.entries(groups)) {
    parentIds[name] = Number(insertParent.run(workspaceId, name, color, icon, description).lastInsertRowid);
  }
  db.prepare(
    `INSERT INTO categories (workspace_id, parent_id, name, color, icon, kind, budget_mode, description)
     VALUES (?, ?, 'Rent', '#C9A27E', 'key-round', 'expense', 'tracking', ?)`
  ).run(workspaceId, parentIds["Home & Bills"], "Monthly rent paid to the landlord (שכר דירה).");
  const setParent = db.prepare(
    "UPDATE categories SET parent_id = ? WHERE workspace_id = ? AND kind = 'expense' AND name = ?"
  );
  for (const [child, parent] of Object.entries(SEEDED_CATEGORY_PARENTS)) {
    if (parentIds[parent]) setParent.run(parentIds[parent], workspaceId, child);
  }

  for (const [key, source] of Object.entries(SOURCES)) {
    // Some older databases carry an earlier import_sources CHECK list that
    // rejects these templates. The labels are cosmetic, so go on without them.
    let importSourceId = null;
    try {
      importSourceId = createImportSource(workspaceId, {
        label: source.label,
        kind: source.kind,
        templateType: source.provider,
        accountHint: source.account,
      });
    } catch (error) {
      if (error?.code !== "SQLITE_CONSTRAINT_CHECK") throw error;
    }
    // One import per monthly file, like a real household would load them.
    const byMonth = new Map();
    for (const row of rows[key]) {
      const month = row.date.slice(0, 7);
      if (!byMonth.has(month)) byMonth.set(month, []);
      byMonth.get(month).push(row);
    }
    for (const [month, monthRows] of [...byMonth].sort()) {
      const runId = createSyncRun(workspaceId, source.provider, null, `${month}-01`, importSourceId);
      const { added, updated } = insertTransactions(workspaceId, monthRows, source.provider, null, runId, {
        importSourceId,
      });
      completeSyncRun(runId, added, updated);
    }
  }

  // Categorize like the pipeline would have: mostly confident AI, a few user
  // corrections, a handful left for review.
  const categorize = db.prepare(
    `UPDATE transactions
     SET category_id = ?, category_source = ?, ai_confidence = ?
     WHERE workspace_id = ? AND description = ? AND kind = ?`
  );
  for (const [description, categoryName] of categoryOf) {
    const kindRow = db
      .prepare("SELECT kind FROM transactions WHERE workspace_id = ? AND description = ? LIMIT 1")
      .get(workspaceId, description);
    if (!kindRow || kindRow.kind === "transfer") continue;
    const category = getCategoryByName(workspaceId, categoryName, kindRow.kind);
    if (!category) throw new Error(`Missing category ${categoryName} (${kindRow.kind})`);
    const byUser = ["Rent", "Kids & Childcare", "Salary"].includes(categoryName);
    categorize.run(category.id, byUser ? "user" : "ai", byUser ? null : intBetween(6, 7), workspaceId, description, kindRow.kind);
  }

  // Needs attention: two low-confidence guesses and one uncategorized row
  // in the current month.
  const thisMonth = todayIso.slice(0, 7);
  db.prepare(
    `UPDATE transactions SET needs_review = 1, ai_confidence = 3
     WHERE id IN (
       SELECT id FROM transactions
       WHERE workspace_id = ? AND kind = 'expense' AND description IN ('ACE', 'הום סנטר', 'שילב', 'פרחי דמו')
       ORDER BY date DESC LIMIT 2
     )`
  ).run(workspaceId);
  const mystery = createSyncRun(workspaceId, "max_bill", null, `${thisMonth}-01`, null);
  insertTransactions(
    workspaceId,
    [
      {
        accountNumber: SOURCES.max.account,
        date: todayIso,
        processedDate: todayIso,
        originalAmount: -64,
        originalCurrency: "ILS",
        chargedAmount: -64,
        chargedCurrency: "ILS",
        description: "פ.י. שירותים בע\"מ",
        type: "normal",
        status: "completed",
      },
    ],
    "max_bill",
    null,
    mystery
  );
  completeSyncRun(mystery, 1, 0);

  const budgets = {
    Groceries: 2600,
    Restaurants: 900,
    "Coffee & Cafes": 350,
    Transport: 1200,
    Shopping: 900,
    Entertainment: 250,
    "Personal Care": 250,
    "Sports & Hobbies": 300,
    "Bills & Utilities": 1100,
    Subscriptions: 150,
    Health: 350,
    "Kids & Childcare": 3300,
    Education: 250,
    "Pet Care": 250,
    Home: 600,
  };
  for (const [name, amount] of Object.entries(budgets)) {
    const category = getCategoryByName(workspaceId, name, "expense");
    if (category) setBudget(workspaceId, category.id, amount, false);
  }

  createTrip(workspaceId, {
    name: "Greece",
    country: "Greece",
    currency: "EUR",
    startDate: gDay(14),
    endDate: gDay(20),
  });
  return workspaceId;
});
const workspaceId = writeDemo();

const suggested = detectTripSuggestions(workspaceId);

for (const id of previous) deleteWorkspace(id);
db.prepare("UPDATE workspaces SET slug = 'demo' WHERE id = ?").run(workspaceId);

const counts = db
  .prepare(
    `SELECT kind, COUNT(*) AS n, ROUND(SUM(charged_amount)) AS total
     FROM transactions WHERE workspace_id = ? AND status = 'completed' GROUP BY kind`
  )
  .all(workspaceId);
db.close();

console.log(`Seeded workspace "${DEMO_NAME}" (id ${workspaceId}) in ${dataDir}`);
for (const c of counts) console.log(`  ${c.kind}: ${c.n} rows, ${c.total} ILS`);
console.log(`  suggested trips: ${suggested.map((t) => t.name).join(", ") || "none"}`);
if (previous.length) console.log(`  replaced previous demo workspace(s): ${previous.join(", ")}`);
console.log('Pick "Demo" in the workspace switcher to view it.');
