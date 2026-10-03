# Home Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Home into a month-scoped overview: income, expenses, net and savings rate first, then a 12-month cash-flow chart, then where the money went, budget pace, averages and the review queue, all driven by `?month=YYYY-MM`.

**Architecture:**
- Pure, shared modules in `src/lib/` own the month math (`home-month.ts`), KPI math (`home-kpis.ts`), category rollup (`home-category-breakdown.ts`), budget verdicts (`home-budget-pace.ts`), `/transactions` deep links (`transactions-url.ts`) and the Needs attention rows (`home-needs-attention.ts`). They are unit tested with `node --test`.
- `src/server/db/queries/home.ts` gains month-aware queries that reuse the existing home money semantics (`getCashFlow`, `EXCLUDE_TRANSFERS_SQL`, `HOME_*_SOURCE_SQL`). `GET /api/home?month=` validates the month and wraps every section in `safe()`.
- `src/components/home/home-page.tsx` gets the final 12-column grid in Task 5. Each later card task swaps one legacy card out of its slot and deletes the legacy payload field.

**Tech Stack:** Next.js 16 App Router (client components, `useSearchParams`, `useRouter`), TanStack Query 5, Recharts 3.8, next-intl (en, he with RTL), better-sqlite3, `node --test` with `--experimental-transform-types`.

**Spec:** `docs/superpowers/specs/2026-10-03-home-redesign-design.md`

## Global Constraints

- No em dashes anywhere in code, comments, docs, JSON messages, or commit messages.
- Conventional commits with a body explaining what and why, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Never read `/transactions/` or `/data/`**, in tests or manual checks. All fixtures and demo data are invented. Manual checks run against a throwaway `SPENT_DATA_DIR` seeded with the synthetic script below.
- Every query filters by `workspace_id`. Do not filter on `transactions.is_excluded` (spec: out of scope).
- Only `completed` transactions count in KPI, trend, breakdown and averages. 6-month averages use completed months only: the up to 6 months immediately before the selected month.
- Keep the existing home money semantics: `kind` in (`income`, `expense`), the `Transfers` category excluded via `EXCLUDE_TRANSFERS_SQL`, all sources (bank plus cards). Card bill payments stay `kind = 'transfer'` and never count.
- `import "server-only"` stays at the top of every file in `src/server/`. Files in `src/lib/` must not import server-only code.
- base-ui, not Radix: no `asChild`.
- Every new user-facing string goes in both `src/i18n/messages/en.json` and `src/i18n/messages/he.json`.
- Chart colors come from theme tokens (`var(--...)`) and are defined for both light and dark themes.
- Before every commit, read `git diff --cached` for anything that looks like a real export (merchant names, real amounts, account numbers).

## Review Focus

- **Current month on the 31st (or the 29th to 31st) when last month is shorter.** Expect the "same days last month" window to clamp to the last day of the previous month (Feb 28), never to roll into March. Pinned in Task 1 (`previousComparisonRange` with `now = 2026-03-31`).
- **A workspace with fewer than 6 months of history, or none.** Expect averages to divide by the months that exist (clipped at the first month with data), and `avg6: null` with a "No earlier months" line when there are none, not a value divided by 6. Pinned in Task 1 (`getAverageWindow`) and Task 2 (fixture history starts in June, so October averages 4 months).
- **A low-confidence AI row that the user already approved.** Expect it to leave the Needs attention count and the `lowConfidence` filter (approval clears `needs_review` but keeps `ai_confidence`). Pinned in Task 4.
- **A typed, stale or future `?month=` (for example `2026-13` or next month from an old bookmark).** Expect the API to answer 400 and the page to fall back to the current month and clean the URL instead of rendering error cards. Pinned in Task 1 (`resolveHomeMonthKey`) and checked manually in Task 5.
- **Where money went must add up to the Expenses tile.** Expect an Uncategorized bucket, pending rows and `Transfers` excluded, so the donut total equals the Expenses KPI. Pinned in Task 3 (DB test compares against `getHomeKpis`).

## Spec ambiguities resolved in this plan

- **"Transfers nets by signed amount".** Home today excludes the `Transfers` category from cash flow (`EXCLUDE_TRANSFERS_SQL`), and `scripts/test-home-analytics.mjs` pins that. The plan keeps that exact behavior ("existing money semantics") so the KPI tiles equal the old Cash flow card. Changing it is a separate decision.
- **"Every section is computed for that month".** Needs attention counts and their links are scoped to the selected month, because `/transactions` only shows one month at a time. Recent transactions show the latest rows up to the end of the selected month (unchanged for the current month). Averages end at the month before the selected month. Bank health stays workspace-wide.
- **Category snapshot.** The spec layout has no slot for `CategorySnapshotCard`; Where money went replaces it and `categorySnapshot` leaves the payload.
- **`pacePhrase` and `monthLabel`.** Both were server-built English strings. `budgetPace` drops them and carries `month` (`YYYY-MM`); the card builds a localized verdict. The trend drops `label` for the same reason.
- **Delta vs 6-month category average in the current month.** Comparing month-to-date spend to a full-month average always looks low early in the month, so the current month shows "n% of avg so far" and past months show a signed delta.
- **Card links to `/transactions`.** That page is bank-only by default. Home links pass `source=all` so card purchases appear, and a removable chip shows the wider scope.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/home-month.ts` | Create | Month keys, ranges, parsing, comparison and average windows |
| `src/lib/home-kpis.ts` | Create | KPI figures, savings rate, deltas |
| `src/lib/home-category-breakdown.ts` | Create | Roll leaves into groups, shares, averages, donut folding |
| `src/lib/home-budget-pace.ts` | Create | Budget verdict message for current and past months |
| `src/lib/transactions-url.ts` | Create | Build and parse `/transactions` deep links |
| `src/lib/home-needs-attention.ts` | Create | Data-driven Needs attention rows (trips adds a row later) |
| `src/lib/transaction-review-filter.ts` | Modify | New review filters, `LOW_CONFIDENCE_MAX` |
| `src/lib/formatters.ts` | Modify | Month-key and compact/signed money formatting |
| `src/lib/types.ts` | Modify | Home payload types |
| `src/lib/api.ts` | Modify | `getHome(month)`, transaction filter params |
| `src/server/lib/home-analytics.ts` | Modify | Trend builder without English labels |
| `src/server/db/queries/home.ts` | Modify | KPI, trend, budget pace, breakdown, needs attention, recent |
| `src/server/db/queries/transactions.ts` | Modify | `uncategorized` and `lowConfidence` filters |
| `src/app/api/home/route.ts` | Modify | `?month=` validation and new payload |
| `src/app/api/transactions/route.ts` | Modify | Parse new filters |
| `src/server/sync/categorization.ts`, `src/app/api/categorize/apply/route.ts` | Modify | Use `LOW_CONFIDENCE_MAX` |
| `src/components/transactions/transactions-page.tsx` | Modify | Seed filters from URL, filter chips |
| `src/components/dashboard/period-selector.tsx` | Modify | Optional disabled and aria labels |
| `src/components/home/home-page.tsx` | Modify | Month state, grid, sections |
| `src/components/home/home-month-picker.tsx` | Create | `‹ Oct 2026 ›` picker |
| `src/components/home/kpi-tiles.tsx` | Create | Four KPI tiles |
| `src/components/home/cash-flow-chart-card.tsx` | Create | Recharts 12-month chart with table view |
| `src/components/home/where-money-went-card.tsx` | Create | Donut and ranked list |
| `src/components/home/budget-pace-card.tsx` | Create | Budget pace (replaces `this-month-card.tsx`) |
| `src/components/home/needs-attention-card.tsx` | Modify | Row model, filtered links |
| `src/components/home/spending-stats-card.tsx` | Modify | Remove `min-h-[560px]` |
| `src/components/home/{cash-flow,historical-trend,category-snapshot,this-month}-card.tsx` | Delete | Replaced |
| `src/app/globals.css` | Modify | `--chart-income`, `--chart-expense` tokens |
| `src/i18n/messages/en.json`, `he.json` | Modify | New strings, removed dead strings |
| `scripts/test-home-analytics.mjs`, `scripts/test-transaction-review-filter.mjs` | Modify | Tests |
| `AGENTS.md` | Modify | Pages description |

## Manual QA environment (synthetic data only)

Every UI task ends with a browser check. Never point the app at `data/`. Use a throwaway data dir.

1. Save this script **outside the repo** as `%TEMP%\spent-home-demo-seed.mjs` (PowerShell: `notepad $env:TEMP\spent-home-demo-seed.mjs`). It only inserts invented rows.

```js
// Synthetic demo data for manual QA of the home page. Invented values only.
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(path.join(process.cwd(), "package.json"));
const Database = require("better-sqlite3");

const dataDir = process.env.SPENT_DATA_DIR;
if (!dataDir) throw new Error("Set SPENT_DATA_DIR to the demo data dir first.");
const db = new Database(path.join(path.resolve(dataDir), "spent.db"));
db.pragma("busy_timeout = 5000");

const WS = 1;
const setSetting = db.prepare(
  `INSERT INTO workspace_settings (workspace_id, key, value) VALUES (?, ?, ?)
   ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value`
);
setSetting.run(WS, "data_source_mode", "xlsx");
setSetting.run(WS, "monthly_target", "9000");
setSetting.run(WS, "payday_day", "10");

const leaves = db
  .prepare(
    `SELECT id FROM categories WHERE workspace_id = ? AND kind = 'expense'
     AND parent_id IS NOT NULL AND name != 'Transfers' ORDER BY id LIMIT 8`
  )
  .all(WS)
  .map((row) => row.id);
const incomeCategory =
  db
    .prepare(
      `SELECT id FROM categories WHERE workspace_id = ? AND kind = 'income'
       AND name != 'Transfers' ORDER BY id LIMIT 1`
    )
    .get(WS)?.id ?? null;

const syncRunId = db
  .prepare(
    `INSERT INTO sync_runs (workspace_id, provider, started_at, status, scrape_from_date)
     VALUES (?, 'demo', datetime('now'), 'completed', date('now'))`
  )
  .run(WS).lastInsertRowid;
const insert = db.prepare(
  `INSERT INTO transactions
     (workspace_id, account_number, date, processed_date, original_amount,
      original_currency, charged_amount, description, type, status, provider,
      sync_run_id, dedup_hash, kind, category_id, category_source, ai_confidence, needs_review)
   VALUES (?, 'demo-0000', ?, ?, ?, 'ILS', ?, ?, 'normal', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

let seq = 0;
function add({
  date, amount, kind, categoryId = null, provider = "isracard_bill",
  status = "completed", description = "Demo merchant",
  source = categoryId ? "user" : null, confidence = null, review = 0,
}) {
  seq += 1;
  insert.run(WS, date, date, amount, amount, description, status, provider,
    syncRunId, `demo-${seq}`, kind, categoryId, source, confidence, review);
}

const today = new Date();
const iso = (y, m, d) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
for (let back = 13; back >= 0; back--) {
  const first = new Date(today.getFullYear(), today.getMonth() - back, 1);
  const y = first.getFullYear();
  const m = first.getMonth();
  const lastDay = back === 0 ? today.getDate() : new Date(y, m + 1, 0).getDate();
  add({ date: iso(y, m, 1), amount: 14000 + (back % 3) * 900, kind: "income",
    categoryId: incomeCategory, provider: "hapoalim_bank_account", description: "Demo salary" });
  for (let i = 0; i < 18; i++) {
    const day = 1 + ((i * 5 + back) % lastDay);
    add({ date: iso(y, m, day), amount: -(120 + ((i * 137 + back * 61) % 900)),
      kind: "expense", categoryId: leaves[i % leaves.length] ?? null });
  }
  add({ date: iso(y, m, Math.min(10, lastDay)), amount: -6200, kind: "transfer",
    provider: "hapoalim_bank_account", description: "Demo card bill" });
}
const firstOfMonth = iso(today.getFullYear(), today.getMonth(), 1);
add({ date: firstOfMonth, amount: -95, kind: "expense", description: "Demo uncategorized" });
add({ date: firstOfMonth, amount: -140, kind: "expense", categoryId: leaves[0],
  source: "ai", confidence: 3, review: 1, description: "Demo low confidence" });
add({ date: firstOfMonth, amount: -60, kind: "expense", categoryId: leaves[1],
  source: "ai", confidence: null, review: 1, description: "Demo flagged" });
add({ date: firstOfMonth, amount: -300, kind: "expense", categoryId: leaves[2],
  status: "pending", description: "Demo pending" });
console.log(`Seeded ${seq} synthetic rows into workspace ${WS}.`);
```

2. Start the app on the demo dir (PowerShell, from the repo root):

```powershell
$env:SPENT_DATA_DIR = "$env:TEMP\spent-home-demo"
npm run dev
```

3. Open `http://127.0.0.1:3000` once (this runs the migrations and redirects to `/setup`). In a second terminal from the repo root:

```powershell
$env:SPENT_DATA_DIR = "$env:TEMP\spent-home-demo"
node "$env:TEMP\spent-home-demo-seed.mjs"
```

4. Reload `http://127.0.0.1:3000`. Home opens in xlsx mode with 14 months of invented data.
5. Language and theme live in **Settings > Appearance**. Mobile width: DevTools device toolbar at 375 px.
6. To start over, stop the server and delete `%TEMP%\spent-home-demo`. Stop the dev server before `npm run build`.

---

### Task 1: Month and KPI helpers

**Files:**
- Create: `src/lib/home-month.ts`
- Create: `src/lib/home-kpis.ts`
- Modify: `src/lib/formatters.ts` (append new helpers after `addMonths`)
- Modify: `src/lib/types.ts:171-175` (add KPI types after `HomeCashFlow`)
- Test: `scripts/test-home-analytics.mjs`

**Interfaces:**
- Produces (`src/lib/home-month.ts`):
  - `HOME_AVERAGE_MONTHS = 6`
  - `interface HomeMonthRange { key: string; year: number; monthIndex: number; from: string; to: string; daysInMonth: number; isCurrent: boolean; elapsedDays: number }`
  - `type HomeMonthParseResult = { ok: true; month: HomeMonthRange } | { ok: false; error: "invalid_month" | "future_month" }`
  - `interface HomeAverageWindow { from: string; to: string; months: string[] }`
  - `monthKeyFromDate(date: Date): string`, `monthKeyToDate(key: string): Date`, `isValidMonthKey(raw): raw is string`, `shiftMonthKey(key: string, delta: number): string`, `trendMonthKeys(endKey: string, count: number): string[]`
  - `buildHomeMonthRange(key: string, now: Date): HomeMonthRange`, `parseHomeMonth(raw: string | null, now: Date): HomeMonthParseResult`, `resolveHomeMonthKey(raw: string | null, now: Date): string`, `homeHrefForMonth(key: string, now: Date): string`
  - `previousComparisonRange(month: HomeMonthRange): { from: string; to: string }`
  - `getAverageWindow(month: HomeMonthRange, firstDataMonth: string | null, size?: number): HomeAverageWindow | null`
- Produces (`src/lib/home-kpis.ts`):
  - `type HomeKpiKey = "income" | "expenses" | "net" | "savingsRate"`
  - `interface HomeKpiDelta { unit: "percent" | "currency" | "points"; value: number; favorable: boolean | null }`
  - `computeSavingsRate(income: number, net: number): number | null`
  - `toKpiFigures(income: number, expenses: number): HomeKpiFigures`
  - `buildHomeKpis(month: HomeMonthRange, current: { income: number; expenses: number }, prev: { income: number; expenses: number }, average: { income: number; expenses: number; months: number } | null): HomeKpis`
  - `computeKpiDelta(key: HomeKpiKey, current: HomeKpiFigures, prev: HomeKpiFigures): HomeKpiDelta | null`
- Produces (`src/lib/types.ts`): `HomeKpiFigures { income; expenses; net; savingsRate: number | null }`, `HomeKpis extends HomeKpiFigures { month; prev; avg6: (HomeKpiFigures & { months: number }) | null; isCurrentMonth; dayOfMonth; daysInMonth }`
- Produces (`src/lib/formatters.ts`): `formatMonthKey(key, locale?, style?: "short" | "long", withYear?: boolean)`, `formatWholeCurrency(amount, locale?)`, `formatCompactCurrency(amount, locale?)`, `formatSignedNumber(value)`, `formatSignedPercent(value)`, `formatSignedCurrency(amount, locale?)`

- [ ] **Step 1: Write the failing tests**

In `scripts/test-home-analytics.mjs`, change the `node:fs` import on line 2 to:

```js
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
```

Append to the end of the file:

```js
const FIXTURE_NOW = new Date(2026, 9, 3, 12, 0, 0);

test("home month parsing defaults to the current month and rejects bad or future months", async () => {
  const { parseHomeMonth } = await import("../src/lib/home-month.ts");

  const current = parseHomeMonth(null, FIXTURE_NOW);
  assert.equal(current.ok, true);
  assert.deepEqual(current.month, {
    key: "2026-10",
    year: 2026,
    monthIndex: 9,
    from: "2026-10-01",
    to: "2026-10-31",
    daysInMonth: 31,
    isCurrent: true,
    elapsedDays: 3,
  });

  const february = parseHomeMonth("2026-02", FIXTURE_NOW);
  assert.equal(february.ok, true);
  assert.equal(february.month.to, "2026-02-28");
  assert.equal(february.month.isCurrent, false);
  assert.equal(february.month.elapsedDays, 28);

  for (const raw of ["2026-13", "2026-00", "2026-1", "26-10", "2026-10-01", "abc"]) {
    assert.deepEqual(parseHomeMonth(raw, FIXTURE_NOW), { ok: false, error: "invalid_month" }, raw);
  }
  assert.deepEqual(parseHomeMonth("2026-11", FIXTURE_NOW), { ok: false, error: "future_month" });
  assert.deepEqual(parseHomeMonth("2027-01", FIXTURE_NOW), { ok: false, error: "future_month" });
});

test("home month helpers resolve URLs and shift months across years", async () => {
  const m = await import("../src/lib/home-month.ts");

  assert.equal(m.resolveHomeMonthKey("2027-01", FIXTURE_NOW), "2026-10");
  assert.equal(m.resolveHomeMonthKey("garbage", FIXTURE_NOW), "2026-10");
  assert.equal(m.resolveHomeMonthKey(null, FIXTURE_NOW), "2026-10");
  assert.equal(m.resolveHomeMonthKey("2026-05", FIXTURE_NOW), "2026-05");
  assert.equal(m.homeHrefForMonth("2026-10", FIXTURE_NOW), "/");
  assert.equal(m.homeHrefForMonth("2026-08", FIXTURE_NOW), "/?month=2026-08");
  assert.equal(m.shiftMonthKey("2026-01", -1), "2025-12");
  assert.equal(m.shiftMonthKey("2025-12", 1), "2026-01");
  assert.deepEqual(m.trendMonthKeys("2026-02", 3), ["2025-12", "2026-01", "2026-02"]);
  assert.equal(m.trendMonthKeys("2026-10", 12)[0], "2025-11");
  const feb = m.monthKeyToDate("2026-02");
  assert.deepEqual([feb.getFullYear(), feb.getMonth(), feb.getDate()], [2026, 1, 1]);
});

test("previous-month comparison uses the same days for the current month and clamps short months", async () => {
  const { buildHomeMonthRange, previousComparisonRange } = await import("../src/lib/home-month.ts");

  assert.deepEqual(previousComparisonRange(buildHomeMonthRange("2026-10", FIXTURE_NOW)), {
    from: "2026-09-01",
    to: "2026-09-03",
  });
  const marchThirtyFirst = new Date(2026, 2, 31, 9, 0, 0);
  assert.deepEqual(previousComparisonRange(buildHomeMonthRange("2026-03", marchThirtyFirst)), {
    from: "2026-02-01",
    to: "2026-02-28",
  });
  assert.deepEqual(previousComparisonRange(buildHomeMonthRange("2026-08", FIXTURE_NOW)), {
    from: "2026-07-01",
    to: "2026-07-31",
  });
  assert.deepEqual(previousComparisonRange(buildHomeMonthRange("2026-01", FIXTURE_NOW)), {
    from: "2025-12-01",
    to: "2025-12-31",
  });
});

test("average window covers up to six completed months before the selected month", async () => {
  const { buildHomeMonthRange, getAverageWindow } = await import("../src/lib/home-month.ts");
  const october = buildHomeMonthRange("2026-10", FIXTURE_NOW);

  assert.deepEqual(getAverageWindow(october, "2026-06"), {
    from: "2026-06-01",
    to: "2026-09-30",
    months: ["2026-06", "2026-07", "2026-08", "2026-09"],
  });
  assert.deepEqual(getAverageWindow(october, "2020-01"), {
    from: "2026-04-01",
    to: "2026-09-30",
    months: ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
  });
  assert.equal(getAverageWindow(october, null), null);
  assert.equal(getAverageWindow(october, "2026-10"), null);
  assert.deepEqual(getAverageWindow(buildHomeMonthRange("2026-01", FIXTURE_NOW), "2025-01"), {
    from: "2025-07-01",
    to: "2025-12-31",
    months: ["2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12"],
  });
});

test("KPI figures report savings rate as n/a when income is zero", async () => {
  const { buildHomeKpis, toKpiFigures } = await import("../src/lib/home-kpis.ts");
  const { buildHomeMonthRange } = await import("../src/lib/home-month.ts");

  assert.deepEqual(toKpiFigures(0, 500), { income: 0, expenses: 500, net: -500, savingsRate: null });
  assert.deepEqual(toKpiFigures(10000, 12000), { income: 10000, expenses: 12000, net: -2000, savingsRate: -0.2 });

  const kpis = buildHomeKpis(
    buildHomeMonthRange("2026-08", FIXTURE_NOW),
    { income: 12000, expenses: 6000 },
    { income: 0, expenses: 0 },
    null
  );
  assert.deepEqual(kpis, {
    month: "2026-08",
    income: 12000,
    expenses: 6000,
    net: 6000,
    savingsRate: 0.5,
    prev: { income: 0, expenses: 0, net: 0, savingsRate: null },
    avg6: null,
    isCurrentMonth: false,
    dayOfMonth: 31,
    daysInMonth: 31,
  });
});

test("KPI deltas use percent, shekels and points with the right direction", async () => {
  const { computeKpiDelta, toKpiFigures } = await import("../src/lib/home-kpis.ts");
  const current = toKpiFigures(10000, 6000);
  const prev = toKpiFigures(8000, 5000);

  assert.deepEqual(computeKpiDelta("income", current, prev), { unit: "percent", value: 25, favorable: true });
  assert.deepEqual(computeKpiDelta("expenses", current, prev), { unit: "percent", value: 20, favorable: false });
  assert.deepEqual(computeKpiDelta("net", current, prev), { unit: "currency", value: 1000, favorable: true });
  const rate = computeKpiDelta("savingsRate", current, prev);
  assert.equal(rate.unit, "points");
  assert.equal(Math.round(rate.value * 10) / 10, 2.5);
  assert.equal(rate.favorable, true);

  const empty = toKpiFigures(0, 0);
  for (const key of ["income", "expenses", "net", "savingsRate"]) {
    assert.equal(computeKpiDelta(key, current, empty), null, key);
  }

  const noPrevIncome = toKpiFigures(0, 4000);
  assert.equal(computeKpiDelta("income", current, noPrevIncome), null);
  assert.equal(computeKpiDelta("savingsRate", current, noPrevIncome), null);
  assert.deepEqual(computeKpiDelta("expenses", current, noPrevIncome), { unit: "percent", value: 50, favorable: false });

  assert.equal(computeKpiDelta("net", toKpiFigures(1000, 500.2), toKpiFigures(1000, 500)).favorable, null);
});

test("formatters render month keys and compact or signed money", async () => {
  const f = await import("../src/lib/formatters.ts");

  assert.equal(f.formatMonthKey("2026-10", "en", "short"), "Oct 2026");
  assert.equal(f.formatMonthKey("2026-01", "en", "long", false), "January");
  assert.equal(f.formatWholeCurrency(12345.6, "en"), "₪12,346");
  assert.equal(f.formatCompactCurrency(12500, "en"), "₪12.5K");
  assert.equal(f.formatCompactCurrency(-3000, "en"), "−₪3K");
  assert.equal(f.formatSignedNumber(3.2), "+3");
  assert.equal(f.formatSignedPercent(12.4), "+12%");
  assert.equal(f.formatSignedPercent(-7.6), "−8%");
  assert.equal(f.formatSignedPercent(-0.4), "0%");
  assert.equal(f.formatSignedCurrency(-1200.4, "en"), "−₪1,200");
  assert.equal(f.formatSignedCurrency(0.3, "en"), "₪0");
});

test("home and transactions messages have matching keys in English and Hebrew", () => {
  const read = (locale) =>
    JSON.parse(
      readFileSync(path.join(process.cwd(), "src", "i18n", "messages", `${locale}.json`), "utf8")
    );
  const en = read("en");
  const he = read("he");
  for (const namespace of ["home", "transactions"]) {
    assert.deepEqual(Object.keys(he[namespace]).sort(), Object.keys(en[namespace]).sort(), namespace);
  }
  const homeText = JSON.stringify(en.home) + JSON.stringify(he.home);
  const emDash = String.fromCharCode(0x2014);
  assert.equal(homeText.includes(emDash), false, "no em dashes in home messages");
});
```

The last test is a guard for later tasks and passes today.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --conditions react-server --experimental-transform-types --test scripts/test-home-analytics.mjs`
Expected: FAIL. The new month and KPI tests fail with `ERR_MODULE_NOT_FOUND` for `src/lib/home-month.ts` and `src/lib/home-kpis.ts`; the formatter test fails with `f.formatMonthKey is not a function`. Existing tests and the i18n guard pass.

- [ ] **Step 3: Create `src/lib/home-month.ts`**

```ts
export const HOME_AVERAGE_MONTHS = 6;

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface HomeMonthRange {
  /** "YYYY-MM" */
  key: string;
  year: number;
  /** 0-based, like Date#getMonth */
  monthIndex: number;
  /** "YYYY-MM-01" */
  from: string;
  /** Last day of the month, "YYYY-MM-DD" */
  to: string;
  daysInMonth: number;
  /** True for the calendar month that contains `now`. */
  isCurrent: boolean;
  /** Today's day of month for the current month, the full month otherwise. */
  elapsedDays: number;
}

export type HomeMonthParseResult =
  | { ok: true; month: HomeMonthRange }
  | { ok: false; error: "invalid_month" | "future_month" };

export interface HomeAverageWindow {
  from: string;
  to: string;
  months: string[];
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function parseKey(key: string): { year: number; monthIndex: number } {
  const [year, monthNumber] = key.split("-").map(Number);
  return { year, monthIndex: monthNumber - 1 };
}

function lastDayOf(key: string): number {
  const { year, monthIndex } = parseKey(key);
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function monthKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

export function monthKeyToDate(key: string): Date {
  const { year, monthIndex } = parseKey(key);
  return new Date(year, monthIndex, 1);
}

export function isValidMonthKey(raw: string | null | undefined): raw is string {
  return typeof raw === "string" && MONTH_KEY_PATTERN.test(raw);
}

export function shiftMonthKey(key: string, delta: number): string {
  const { year, monthIndex } = parseKey(key);
  return monthKeyFromDate(new Date(year, monthIndex + delta, 1));
}

/** `count` month keys ending at `endKey`, oldest first. */
export function trendMonthKeys(endKey: string, count: number): string[] {
  const keys: string[] = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    keys.push(shiftMonthKey(endKey, -offset));
  }
  return keys;
}

export function buildHomeMonthRange(key: string, now: Date): HomeMonthRange {
  const { year, monthIndex } = parseKey(key);
  const daysInMonth = lastDayOf(key);
  const isCurrent = key === monthKeyFromDate(now);
  return {
    key,
    year,
    monthIndex,
    from: `${key}-01`,
    to: `${key}-${pad2(daysInMonth)}`,
    daysInMonth,
    isCurrent,
    elapsedDays: isCurrent ? Math.min(now.getDate(), daysInMonth) : daysInMonth,
  };
}

export function parseHomeMonth(raw: string | null, now: Date): HomeMonthParseResult {
  const currentKey = monthKeyFromDate(now);
  if (raw == null || raw === "") {
    return { ok: true, month: buildHomeMonthRange(currentKey, now) };
  }
  if (!isValidMonthKey(raw)) return { ok: false, error: "invalid_month" };
  // "YYYY-MM" keys sort lexically in calendar order.
  if (raw > currentKey) return { ok: false, error: "future_month" };
  return { ok: true, month: buildHomeMonthRange(raw, now) };
}

/** Client side: a bad or future ?month falls back to the current month. */
export function resolveHomeMonthKey(raw: string | null, now: Date): string {
  const parsed = parseHomeMonth(raw, now);
  return parsed.ok ? parsed.month.key : monthKeyFromDate(now);
}

export function homeHrefForMonth(key: string, now: Date): string {
  return key === monthKeyFromDate(now) ? "/" : `/?month=${key}`;
}

/**
 * The window a month is compared against. The current month compares to the
 * same days of last month (clamped to its length); past months compare to
 * the full previous month.
 */
export function previousComparisonRange(month: HomeMonthRange): {
  from: string;
  to: string;
} {
  const prevKey = shiftMonthKey(month.key, -1);
  const prevDays = lastDayOf(prevKey);
  const lastDay = month.isCurrent
    ? Math.min(month.elapsedDays, prevDays)
    : prevDays;
  return { from: `${prevKey}-01`, to: `${prevKey}-${pad2(lastDay)}` };
}

/**
 * Up to `size` months immediately before the selected month. They are always
 * complete because the selected month is never in the future. Months before
 * the first month with data are dropped so a short history is not diluted.
 */
export function getAverageWindow(
  month: HomeMonthRange,
  firstDataMonth: string | null,
  size: number = HOME_AVERAGE_MONTHS
): HomeAverageWindow | null {
  if (firstDataMonth == null) return null;
  const months = trendMonthKeys(shiftMonthKey(month.key, -1), size).filter(
    (key) => key >= firstDataMonth
  );
  if (months.length === 0) return null;
  const last = months[months.length - 1];
  return {
    from: `${months[0]}-01`,
    to: `${last}-${pad2(lastDayOf(last))}`,
    months,
  };
}
```

- [ ] **Step 4: Add the KPI types to `src/lib/types.ts`**

Directly after the `HomeCashFlow` interface (currently lines 171-175), add:

```ts
export interface HomeKpiFigures {
  income: number;
  expenses: number;
  net: number;
  /** net / income, or null when income is 0 */
  savingsRate: number | null;
}

export interface HomeKpis extends HomeKpiFigures {
  /** "YYYY-MM" */
  month: string;
  prev: HomeKpiFigures;
  avg6: (HomeKpiFigures & { months: number }) | null;
  isCurrentMonth: boolean;
  dayOfMonth: number;
  daysInMonth: number;
}
```

- [ ] **Step 5: Create `src/lib/home-kpis.ts`**

```ts
import type { HomeMonthRange } from "./home-month";
import type { HomeKpiFigures, HomeKpis } from "./types";

export type HomeKpiKey = "income" | "expenses" | "net" | "savingsRate";

export interface HomeKpiDelta {
  /** percent for income/expenses, shekels for net, percentage points for savings rate */
  unit: "percent" | "currency" | "points";
  value: number;
  /** Good for the household (more income, less spending, more net). Null when flat. */
  favorable: boolean | null;
}

export function computeSavingsRate(income: number, net: number): number | null {
  return income > 0 ? net / income : null;
}

export function toKpiFigures(income: number, expenses: number): HomeKpiFigures {
  const net = income - expenses;
  return { income, expenses, net, savingsRate: computeSavingsRate(income, net) };
}

export function buildHomeKpis(
  month: HomeMonthRange,
  current: { income: number; expenses: number },
  prev: { income: number; expenses: number },
  average: { income: number; expenses: number; months: number } | null
): HomeKpis {
  return {
    month: month.key,
    ...toKpiFigures(current.income, current.expenses),
    prev: toKpiFigures(prev.income, prev.expenses),
    avg6:
      average && average.months > 0
        ? {
            ...toKpiFigures(average.income, average.expenses),
            months: average.months,
          }
        : null,
    isCurrentMonth: month.isCurrent,
    dayOfMonth: month.elapsedDays,
    daysInMonth: month.daysInMonth,
  };
}

function isFavorable(key: HomeKpiKey, value: number): boolean | null {
  if (Math.round(value) === 0) return null;
  return key === "expenses" ? value < 0 : value > 0;
}

export function computeKpiDelta(
  key: HomeKpiKey,
  current: HomeKpiFigures,
  prev: HomeKpiFigures
): HomeKpiDelta | null {
  if (prev.income === 0 && prev.expenses === 0) return null;

  if (key === "income" || key === "expenses") {
    const before = prev[key];
    if (before <= 0) return null;
    const value = ((current[key] - before) / before) * 100;
    return { unit: "percent", value, favorable: isFavorable(key, value) };
  }

  if (key === "net") {
    const value = current.net - prev.net;
    return { unit: "currency", value, favorable: isFavorable(key, value) };
  }

  if (current.savingsRate == null || prev.savingsRate == null) return null;
  const value = (current.savingsRate - prev.savingsRate) * 100;
  return { unit: "points", value, favorable: isFavorable(key, value) };
}
```

- [ ] **Step 6: Add the formatters**

In `src/lib/formatters.ts`, directly after the `addMonths` function, add:

```ts
/** Formats a "YYYY-MM" key in the active locale, e.g. "Oct 2026" or "אוק׳ 2026". */
export function formatMonthKey(
  monthKey: string,
  locale?: Locale,
  style: "short" | "long" = "long",
  withYear = true,
): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(
    bcp47(locale),
    withYear ? { month: style, year: "numeric" } : { month: style },
  );
}

export function formatWholeCurrency(amount: number, locale?: Locale): string {
  return `₪${Math.round(Math.abs(amount)).toLocaleString(bcp47(locale))}`;
}

/** Axis ticks: "₪12.5K", "−₪3K". */
export function formatCompactCurrency(amount: number, locale?: Locale): string {
  const sign = amount < 0 ? "−" : "";
  const compact = new Intl.NumberFormat(bcp47(locale), {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Math.abs(amount));
  return `${sign}₪${compact}`;
}

/** Rounded, with "+" or a true minus sign; zero has no sign. */
export function formatSignedNumber(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return "0";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}`;
}

export function formatSignedPercent(value: number): string {
  return `${formatSignedNumber(value)}%`;
}

export function formatSignedCurrency(amount: number, locale?: Locale): string {
  if (Math.round(amount) === 0) return formatWholeCurrency(0, locale);
  return `${amount > 0 ? "+" : "−"}${formatWholeCurrency(amount, locale)}`;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --conditions react-server --experimental-transform-types --test scripts/test-home-analytics.mjs`
Expected: PASS, all tests.

- [ ] **Step 8: Run the full logic suite, type check and lint**

Run: `npm run test:logic`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/home-month.ts src/lib/home-kpis.ts src/lib/formatters.ts src/lib/types.ts scripts/test-home-analytics.mjs
git diff --cached   # read it: synthetic values only
git commit -F - <<'EOF'
feat: add month and KPI helpers for the home redesign

Home is becoming month-scoped (?month=YYYY-MM) with KPI tiles that show
a delta vs last month and a 6-month average. This adds the pure logic
those features share between server and client:

- home-month: parse and validate month keys (invalid and future months
  are rejected), build month ranges, the same-days comparison window for
  the current month (clamped to shorter months), and the average window
  of up to 6 completed months clipped to the first month with data.
- home-kpis: income, expenses, net, savings rate (null when income is 0)
  and typed deltas in percent, shekels or percentage points.
- formatters: locale-aware month-key labels plus compact and signed
  money formatting for tiles and chart axes.
- A guard test that home and transactions messages keep matching keys in
  English and Hebrew and that home strings have no em dashes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Server KPIs, 12-month trend, budget pace and `?month=` on `/api/home`

**Files:**
- Modify: `src/server/lib/home-analytics.ts:10-14,38-65` (trend builder)
- Modify: `src/server/db/queries/home.ts:1-23` (imports), `:107-159` (replace `getHistoricalTrend`)
- Modify: `src/lib/types.ts:151-193,259-270` (section union, budget pace, trend point, payload)
- Modify: `src/app/api/home/route.ts` (full rewrite below)
- Modify: `src/lib/api.ts:323-325` (`getHome`)
- Modify: `src/components/home/home-page.tsx` (query function and section maps)
- Modify: `src/components/home/historical-trend-card.tsx` (locale labels until Task 6 replaces it)
- Modify: `src/i18n/messages/en.json`, `src/i18n/messages/he.json`
- Test: `scripts/test-home-analytics.mjs`

**Interfaces:**
- Consumes (Task 1): `HomeMonthRange`, `buildHomeMonthRange`, `parseHomeMonth`, `previousComparisonRange`, `getAverageWindow`, `trendMonthKeys`, `monthKeyFromDate`, `HOME_AVERAGE_MONTHS`, `buildHomeKpis`, `HomeKpis`.
- Produces (`src/server/db/queries/home.ts`):
  - `getFirstActivityMonth(workspaceId: number): string | null`
  - `getHomeKpis(workspaceId: number, month: HomeMonthRange): HomeKpis`
  - `getCashFlowTrend(workspaceId: number, month: HomeMonthRange, monthCount: number, now: Date): HomeHistoricalTrendPoint[]`
  - `getBudgetPace(workspaceId: number, month: HomeMonthRange, now: Date): HomeBudgetPace`
  - `getHistoricalTrend` is removed.
- Produces (`src/lib/types.ts`):
  - `HomeSection` gains `"kpis" | "budgetPace"`.
  - `HomeBudgetPace { month: string; spent: number; budget: number; deltaVsLastMonth: number | null; daysUntilPayday: number | null; timeElapsedPercent: number; isPast: boolean }`
  - `HomeHistoricalTrendPoint { month; income; expenses; net; isCurrent; isSelected }` (no `label`)
  - `HomePayload` gains `month: string`, `kpis`, `budgetPace`.
- Produces (`src/lib/api.ts`): `getHome(month?: string): Promise<HomePayload>`
- Produces (`src/server/lib/home-analytics.ts`): `buildMonthlyCashFlowTrend(months: { key: string; isCurrent: boolean; isSelected: boolean }[], rows)`

- [ ] **Step 1: Write the failing tests**

In `scripts/test-home-analytics.mjs`, replace the whole `test("home cash-flow trend fills six months with income and expenses", ...)` block with:

```js
test("home cash-flow trend fills each month and flags current and selected", () => {
  const trend = buildMonthlyCashFlowTrend(
    [
      { key: "2026-01", isCurrent: false, isSelected: true },
      { key: "2026-02", isCurrent: true, isSelected: false },
    ],
    [
      { month: "2026-01", kind: "income", total: 10000 },
      { month: "2026-01", kind: "expense", total: 6500 },
      { month: "2026-02", kind: "expense", total: 1200 },
    ]
  );

  assert.deepEqual(trend, [
    { month: "2026-01", income: 10000, expenses: 6500, net: 3500, isCurrent: false, isSelected: true },
    { month: "2026-02", income: 0, expenses: 1200, net: -1200, isCurrent: true, isSelected: false },
  ]);
});
```

Append the shared fixture and the DB tests to the end of the file:

```js
// Workspace 2: invented household with history from June 2026.
// Monthly expenses: Jun 4000, Jul 5000, Aug 6000, Sep 5000 (300 of it on
// Sep 2), Oct 600 so far. Income: 10000, 10000, 12000, 8000, 9000.
let homeFixturePromise;
function getHomeFixture() {
  homeFixturePromise ??= seedHomeFixture();
  return homeFixturePromise;
}

async function seedHomeFixture() {
  const { getDb } = await import("../src/server/db/index.ts");
  const db = getDb();
  const workspaceId = 2;
  db.prepare(
    `INSERT INTO workspaces (id, name, slug) VALUES (?, 'Home fixture', 'home-fixture')`
  ).run(workspaceId);
  const syncRunId = db
    .prepare(
      `INSERT INTO sync_runs (workspace_id, provider, started_at, status, scrape_from_date)
       VALUES (?, 'test', '2026-06-01', 'completed', '2026-06-01')`
    )
    .run(workspaceId).lastInsertRowid;

  const addCategory = (name, { parentId = null, kind = "expense", color }) =>
    Number(
      db
        .prepare(
          `INSERT INTO categories (workspace_id, parent_id, name, color, kind)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(workspaceId, parentId, name, color, kind).lastInsertRowid
    );
  const food = addCategory("Food", { color: "#E7A875" });
  const groceries = addCategory("Groceries", { parentId: food, color: "#8FBC8A" });
  const restaurants = addCategory("Restaurants", { parentId: food, color: "#E29C71" });
  const utilities = addCategory("Utilities", { color: "#7D90CA" });
  const transfers = addCategory("Transfers", { color: "#A2ABBB" });
  const salary = addCategory("Salary", { kind: "income", color: "#65C1D1" });

  const insert = db.prepare(
    `INSERT INTO transactions
       (workspace_id, account_number, date, processed_date, original_amount,
        original_currency, charged_amount, description, type, status,
        provider, sync_run_id, dedup_hash, kind, category_id)
     VALUES (?, 'acct', ?, ?, ?, 'ILS', ?, 'Synthetic row', 'normal', ?, ?, ?, ?, ?, ?)`
  );
  let rowIndex = 0;
  const add = (date, amount, kind, categoryId, options = {}) => {
    const provider =
      options.provider ?? (kind === "income" ? "hapoalim_bank_account" : "isracard_bill");
    rowIndex += 1;
    insert.run(
      workspaceId, date, date, amount, amount, options.status ?? "completed",
      provider, syncRunId, `home-fixture-${rowIndex}`, kind, categoryId
    );
  };

  for (const [date, amount] of [
    ["2026-06-01", 10000],
    ["2026-07-01", 10000],
    ["2026-08-01", 12000],
    ["2026-09-01", 8000],
    ["2026-10-01", 9000],
  ]) {
    add(date, amount, "income", salary);
  }
  for (const [date, amount, categoryId] of [
    ["2026-06-12", -2500, groceries],
    ["2026-06-20", -1500, utilities],
    ["2026-07-12", -3000, groceries],
    ["2026-07-14", -1000, restaurants],
    ["2026-07-20", -1000, utilities],
    ["2026-08-12", -3500, groceries],
    ["2026-08-14", -1500, restaurants],
    ["2026-08-20", -1000, utilities],
    ["2026-09-02", -300, groceries],
    ["2026-09-10", -2700, groceries],
    ["2026-09-14", -1000, restaurants],
    ["2026-09-20", -1000, utilities],
    ["2026-10-02", -250, groceries],
    ["2026-10-02", -150, restaurants],
    ["2026-10-02", -120, utilities],
    ["2026-10-02", -80, null],
  ]) {
    add(date, amount, "expense", categoryId);
  }
  // Rows that must never count: pending, Transfers category, card-bill transfer.
  add("2026-10-02", -999, "expense", groceries, { status: "pending" });
  add("2026-10-02", -500, "expense", transfers);
  add("2026-10-02", -2000, "transfer", null, { provider: "hapoalim_bank_account" });

  db.prepare(
    `INSERT INTO workspace_settings (workspace_id, key, value)
     VALUES (?, 'monthly_target', '8000'), (?, 'payday_day', '10')`
  ).run(workspaceId, workspaceId);

  return {
    workspaceId,
    categories: { food, groceries, restaurants, utilities, transfers, salary },
  };
}

test("home KPIs for the current month compare the same days last month and average completed months only", async () => {
  const { workspaceId } = await getHomeFixture();
  const { getHomeKpis } = await import("../src/server/db/queries/home.ts");
  const { buildHomeMonthRange } = await import("../src/lib/home-month.ts");

  const kpis = getHomeKpis(workspaceId, buildHomeMonthRange("2026-10", FIXTURE_NOW));

  assert.deepEqual(kpis, {
    month: "2026-10",
    income: 9000,
    expenses: 600,
    net: 8400,
    savingsRate: 8400 / 9000,
    prev: { income: 8000, expenses: 300, net: 7700, savingsRate: 7700 / 8000 },
    // June to September only: October is still in progress and May has no data.
    avg6: { income: 10000, expenses: 5000, net: 5000, savingsRate: 0.5, months: 4 },
    isCurrentMonth: true,
    dayOfMonth: 3,
    daysInMonth: 31,
  });
});

test("home KPIs for a past month compare full months and average the months before it", async () => {
  const { workspaceId } = await getHomeFixture();
  const { getHomeKpis } = await import("../src/server/db/queries/home.ts");
  const { buildHomeMonthRange } = await import("../src/lib/home-month.ts");

  const kpis = getHomeKpis(workspaceId, buildHomeMonthRange("2026-08", FIXTURE_NOW));

  assert.deepEqual(kpis, {
    month: "2026-08",
    income: 12000,
    expenses: 6000,
    net: 6000,
    savingsRate: 0.5,
    prev: { income: 10000, expenses: 5000, net: 5000, savingsRate: 0.5 },
    avg6: { income: 10000, expenses: 4500, net: 5500, savingsRate: 5500 / 10000, months: 2 },
    isCurrentMonth: false,
    dayOfMonth: 31,
    daysInMonth: 31,
  });
});

test("home KPIs for a workspace without history have no average and no savings rate", async () => {
  await getHomeFixture();
  const { getHomeKpis } = await import("../src/server/db/queries/home.ts");
  const { buildHomeMonthRange } = await import("../src/lib/home-month.ts");

  const kpis = getHomeKpis(99, buildHomeMonthRange("2026-10", FIXTURE_NOW));

  assert.equal(kpis.avg6, null);
  assert.equal(kpis.savingsRate, null);
  assert.equal(kpis.expenses, 0);
});

test("home cash-flow trend returns 12 months ending at the selected month", async () => {
  const { workspaceId } = await getHomeFixture();
  const { getCashFlowTrend } = await import("../src/server/db/queries/home.ts");
  const { buildHomeMonthRange } = await import("../src/lib/home-month.ts");

  const october = getCashFlowTrend(workspaceId, buildHomeMonthRange("2026-10", FIXTURE_NOW), 12, FIXTURE_NOW);
  assert.equal(october.length, 12);
  assert.deepEqual(october[0], {
    month: "2025-11", income: 0, expenses: 0, net: 0, isCurrent: false, isSelected: false,
  });
  assert.deepEqual(october[10], {
    month: "2026-09", income: 8000, expenses: 5000, net: 3000, isCurrent: false, isSelected: false,
  });
  assert.deepEqual(october[11], {
    month: "2026-10", income: 9000, expenses: 600, net: 8400, isCurrent: true, isSelected: true,
  });

  const august = getCashFlowTrend(workspaceId, buildHomeMonthRange("2026-08", FIXTURE_NOW), 12, FIXTURE_NOW);
  assert.equal(august[11].month, "2026-08");
  assert.equal(august[11].isSelected, true);
  assert.equal(august[11].isCurrent, false);
});

test("budget pace tracks the current month and gives a final view of past months", async () => {
  const { workspaceId } = await getHomeFixture();
  const { getBudgetPace } = await import("../src/server/db/queries/home.ts");
  const { buildHomeMonthRange } = await import("../src/lib/home-month.ts");

  assert.deepEqual(getBudgetPace(workspaceId, buildHomeMonthRange("2026-10", FIXTURE_NOW), FIXTURE_NOW), {
    month: "2026-10",
    spent: 600,
    budget: 8000,
    deltaVsLastMonth: 100,
    daysUntilPayday: 7,
    timeElapsedPercent: (3 / 31) * 100,
    isPast: false,
  });
  assert.deepEqual(getBudgetPace(workspaceId, buildHomeMonthRange("2026-08", FIXTURE_NOW), FIXTURE_NOW), {
    month: "2026-08",
    spent: 6000,
    budget: 8000,
    deltaVsLastMonth: 20,
    daysUntilPayday: null,
    timeElapsedPercent: 100,
    isPast: true,
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --conditions react-server --experimental-transform-types --test scripts/test-home-analytics.mjs`
Expected: FAIL. The trend builder test fails on the extra `label` key and missing `isSelected`; the DB tests fail with `getHomeKpis is not a function` (and the same for `getCashFlowTrend`, `getBudgetPace`).

- [ ] **Step 3: Update the trend builder in `src/server/lib/home-analytics.ts`**

Replace the `MonthInfo` interface:

```ts
interface MonthInfo {
  key: string;
  isCurrent: boolean;
  isSelected: boolean;
}
```

In `buildMonthlyCashFlowTrend`, replace the returned object inside `months.map` with:

```ts
    return {
      month: month.key,
      income: total.income,
      expenses: total.expenses,
      net: total.income - total.expenses,
      isCurrent: month.isCurrent,
      isSelected: month.isSelected,
    };
```

- [ ] **Step 4: Update the types in `src/lib/types.ts`**

Replace the `HomeSection` union:

```ts
export type HomeSection =
  | "kpis"
  | "budgetPace"
  | "thisMonth"
  | "cashFlow"
  | "categorySnapshot"
  | "historicalTrend"
  | "recentTransactions"
  | "spendingStats"
  | "needsAttention"
  | "bankHealth";
```

Directly after the `HomeThisMonth` interface, add:

```ts
export interface HomeBudgetPace {
  /** "YYYY-MM" */
  month: string;
  spent: number;
  budget: number;
  deltaVsLastMonth: number | null;
  /** Null for past months. */
  daysUntilPayday: number | null;
  timeElapsedPercent: number;
  isPast: boolean;
}
```

Replace the `HomeHistoricalTrendPoint` interface:

```ts
export interface HomeHistoricalTrendPoint {
  /** "YYYY-MM"; labels are formatted on the client in the active locale. */
  month: string;
  income: number;
  expenses: number;
  net: number;
  /** The calendar month that is still in progress. */
  isCurrent: boolean;
  /** The month chosen in the month picker. */
  isSelected: boolean;
}
```

Replace the `HomePayload` interface:

```ts
export interface HomePayload {
  /** The month every section was computed for, "YYYY-MM". */
  month: string;
  kpis: HomeKpis | null;
  budgetPace: HomeBudgetPace | null;
  thisMonth: HomeThisMonth | null;
  cashFlow: HomeCashFlow | null;
  categorySnapshot: HomeCategorySnapshotItem[] | null;
  historicalTrend: HomeHistoricalTrendPoint[] | null;
  recentTransactions: HomeRecentTransaction[] | null;
  spendingStats: HomeSpendingStats | null;
  needsAttention: HomeNeedsAttention | null;
  bankHealth: HomeBankHealthItem[] | null;
  nextScheduledSync: string | null;
  errors: HomeSectionError[];
}
```

- [ ] **Step 5: Add the server queries in `src/server/db/queries/home.ts`**

Replace the import block at the top of the file (lines 1-23) with:

```ts
import "server-only";

import { getDb } from "../index";
import { getWorkspaceSetting } from "./settings";
import { daysUntil, nextPayday } from "../../lib/pace";
import {
  buildCashFlowAverages,
  buildMonthlyCashFlowTrend,
  HOME_CASH_FLOW_SOURCE_TYPE,
  HOME_CATEGORY_SOURCE_TYPE,
} from "../../lib/home-analytics";
import {
  BANK_TRANSACTION_PROVIDERS,
  type TransactionSourceType,
} from "@/lib/transaction-source-types";
import {
  getAverageWindow,
  HOME_AVERAGE_MONTHS,
  monthKeyFromDate,
  previousComparisonRange,
  trendMonthKeys,
  type HomeMonthRange,
} from "@/lib/home-month";
import { buildHomeKpis } from "@/lib/home-kpis";
import type {
  HomeBankHealthItem,
  HomeBudgetPace,
  HomeCashFlow,
  HomeCategorySnapshotItem,
  HomeHistoricalTrendPoint,
  HomeKpis,
  HomeNeedsAttention,
  HomeRecentTransaction,
  HomeSpendingStats,
} from "@/lib/types";
import { BANK_PROVIDERS } from "@/lib/types";
```

(`toLocalISODate` is no longer imported: only the removed `getHistoricalTrend` used it.)

Replace the whole `getHistoricalTrend` function (from `export function getHistoricalTrend(` to its closing brace, just before `export function getSpendingStats`) with:

```ts
interface MonthlyCashFlowRow {
  month: string;
  kind: "income" | "expense";
  total: number;
}

function getMonthlyCashFlowRows(
  workspaceId: number,
  from: string,
  to: string
): MonthlyCashFlowRow[] {
  return getDb()
    .prepare(
      `SELECT strftime('%Y-%m', t.date) as month,
              t.kind as kind,
              CASE
                WHEN t.kind = 'income' THEN SUM(t.charged_amount)
                ELSE SUM(ABS(t.charged_amount))
              END as total
       FROM transactions t
       WHERE t.workspace_id = ? AND t.date >= ? AND t.date <= ?
         AND t.status = 'completed'
         AND t.kind IN ('income', 'expense')
         AND ${HOME_CASH_FLOW_SOURCE_SQL}
         AND ${EXCLUDE_TRANSFERS_SQL}
       GROUP BY month, t.kind
       ORDER BY month ASC`
    )
    .all(workspaceId, from, to, ...HOME_CASH_FLOW_SOURCE_PROVIDERS) as MonthlyCashFlowRow[];
}

/** First "YYYY-MM" with completed income or expense rows, or null. */
export function getFirstActivityMonth(workspaceId: number): string | null {
  const row = getDb()
    .prepare(
      `SELECT MIN(strftime('%Y-%m', t.date)) as month
       FROM transactions t
       WHERE t.workspace_id = ?
         AND t.status = 'completed'
         AND t.kind IN ('income', 'expense')
         AND ${HOME_CASH_FLOW_SOURCE_SQL}
         AND ${EXCLUDE_TRANSFERS_SQL}`
    )
    .get(workspaceId, ...HOME_CASH_FLOW_SOURCE_PROVIDERS) as { month: string | null };
  return row.month;
}

export function getHomeKpis(workspaceId: number, month: HomeMonthRange): HomeKpis {
  const current = getCashFlow(workspaceId, month.from, month.to);
  const prevRange = previousComparisonRange(month);
  const prev = getCashFlow(workspaceId, prevRange.from, prevRange.to);
  const window = getAverageWindow(
    month,
    getFirstActivityMonth(workspaceId),
    HOME_AVERAGE_MONTHS
  );
  const average = window
    ? buildCashFlowAverages(
        getMonthlyCashFlowRows(workspaceId, window.from, window.to),
        window.months.length
      )
    : null;

  return buildHomeKpis(
    month,
    current,
    prev,
    average && window
      ? {
          income: average.meanIncome,
          expenses: average.meanExpense,
          months: window.months.length,
        }
      : null
  );
}

export function getCashFlowTrend(
  workspaceId: number,
  month: HomeMonthRange,
  monthCount: number,
  now: Date
): HomeHistoricalTrendPoint[] {
  const keys = trendMonthKeys(month.key, monthCount);
  const currentKey = monthKeyFromDate(now);
  const rows = getMonthlyCashFlowRows(workspaceId, `${keys[0]}-01`, month.to);
  return buildMonthlyCashFlowTrend(
    keys.map((key) => ({
      key,
      isCurrent: key === currentKey,
      isSelected: key === month.key,
    })),
    rows
  );
}

export function getBudgetPace(
  workspaceId: number,
  month: HomeMonthRange,
  now: Date
): HomeBudgetPace {
  const spent = getCashFlow(workspaceId, month.from, month.to).expenses;
  const prevRange = previousComparisonRange(month);
  const prevSpent = getCashFlow(workspaceId, prevRange.from, prevRange.to).expenses;

  const targetRaw = getWorkspaceSetting(workspaceId, "monthly_target");
  const parsedTarget = targetRaw != null ? Number(targetRaw) : NaN;
  const budget = Number.isFinite(parsedTarget) && parsedTarget > 0 ? parsedTarget : 0;

  const isPast = !month.isCurrent;
  const timeElapsedPercent = isPast
    ? 100
    : Math.min(100, (Math.max(1, month.elapsedDays) / month.daysInMonth) * 100);

  const paydayDay = Number(getWorkspaceSetting(workspaceId, "payday_day") ?? "1");
  const daysUntilPayday = isPast
    ? null
    : Math.max(0, daysUntil(nextPayday(now, paydayDay), now));

  return {
    month: month.key,
    spent,
    budget,
    deltaVsLastMonth: prevSpent > 0 ? ((spent - prevSpent) / prevSpent) * 100 : null,
    daysUntilPayday,
    timeElapsedPercent,
    isPast,
  };
}
```

- [ ] **Step 6: Rewrite `src/app/api/home/route.ts`**

The legacy `thisMonth`, `cashFlow` and `categorySnapshot` sections stay until their cards are replaced (Tasks 5, 7, 8).

```ts
import { NextResponse } from "next/server";
import { getPeriodTotal } from "@/server/db/queries/transactions";
import {
  getLastCompleteMonthEnd,
  HOME_CASH_FLOW_SOURCE_TYPE,
} from "@/server/lib/home-analytics";
import {
  getBankHealth,
  getBudgetPace,
  getCashFlow,
  getCashFlowTrend,
  getCategorySnapshot,
  getHomeKpis,
  getNeedsAttentionCounts,
  getRecentTransactionsForHome,
  getSpendingStats,
} from "@/server/db/queries/home";
import { getWorkspaceSetting } from "@/server/db/queries/settings";
import { getNextRunAt } from "@/server/sync/scheduler";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import {
  daysInMonth,
  dayWithinMonth,
  daysUntil,
  nextPayday,
  pacePhrase,
} from "@/server/lib/pace";
import { toLocalISODate } from "@/server/lib/date-utils";
import { parseHomeMonth } from "@/lib/home-month";
import type {
  HomeBankHealthItem,
  HomeBudgetPace,
  HomeCashFlow,
  HomeCategorySnapshotItem,
  HomeHistoricalTrendPoint,
  HomeKpis,
  HomeNeedsAttention,
  HomePayload,
  HomeRecentTransaction,
  HomeSection,
  HomeSectionError,
  HomeSpendingStats,
  HomeThisMonth,
} from "@/lib/types";

const TREND_MONTHS = 12;
const STATS_DEFAULT_MONTHS = 6;
const RECENT_TXN_LIMIT = 8;
const CATEGORY_SNAPSHOT_LIMIT = 6;

function safe<T>(
  section: HomeSection,
  errors: HomeSectionError[],
  fn: () => T
): T | null {
  try {
    return fn();
  } catch (err) {
    errors.push({
      section,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const now = new Date();

  const parsedMonth = parseHomeMonth(
    new URL(request.url).searchParams.get("month"),
    now
  );
  if (!parsedMonth.ok) {
    return NextResponse.json(
      {
        error:
          parsedMonth.error === "future_month"
            ? "month cannot be in the future"
            : "month must be formatted as YYYY-MM",
      },
      { status: 400 }
    );
  }
  const selected = parsedMonth.month;

  // Legacy current-month window for the thisMonth section, removed with ThisMonthCard.
  const year = now.getFullYear();
  const month = now.getMonth();

  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const from = toLocalISODate(monthStart);
  const to = toLocalISODate(monthEnd);
  const monthLabel = monthStart.toLocaleDateString("en-US", { month: "long" });

  const totalDays = daysInMonth(year, month);
  const elapsedDays = Math.max(1, dayWithinMonth(now, year, month));
  const timeElapsedPercent = Math.min(100, (elapsedDays / totalDays) * 100);

  const paydayDay = Number(getWorkspaceSetting(workspaceId, "payday_day") ?? "1");
  const payday = nextPayday(now, paydayDay);
  const daysUntilPayday = Math.max(0, daysUntil(payday));

  const errors: HomeSectionError[] = [];

  const kpis = safe<HomeKpis>("kpis", errors, () =>
    getHomeKpis(workspaceId, selected)
  );

  const budgetPace = safe<HomeBudgetPace>("budgetPace", errors, () =>
    getBudgetPace(workspaceId, selected, now)
  );

  const thisMonth = safe<HomeThisMonth>("thisMonth", errors, () => {
    const spent = getPeriodTotal(workspaceId, from, to, {
      excludeTransfers: true,
      sourceType: HOME_CASH_FLOW_SOURCE_TYPE,
    });
    const monthlyTargetRaw = getWorkspaceSetting(workspaceId, "monthly_target");
    const parsed = monthlyTargetRaw != null ? Number(monthlyTargetRaw) : NaN;
    const budget = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;

    // Same window last month: from day 1 to today's day-of-month (clamped).
    const prevMonthStart = new Date(year, month - 1, 1);
    const prevElapsedDay = Math.min(
      elapsedDays,
      daysInMonth(prevMonthStart.getFullYear(), prevMonthStart.getMonth())
    );
    const prevMonthMtdEnd = new Date(
      prevMonthStart.getFullYear(),
      prevMonthStart.getMonth(),
      prevElapsedDay
    );
    const prevSpent = getPeriodTotal(
      workspaceId,
      toLocalISODate(prevMonthStart),
      toLocalISODate(prevMonthMtdEnd),
      { excludeTransfers: true, sourceType: HOME_CASH_FLOW_SOURCE_TYPE }
    );
    const deltaVsLastMonth =
      prevSpent > 0 ? ((spent - prevSpent) / prevSpent) * 100 : null;

    const phrase = pacePhrase(spent, spent, budget, timeElapsedPercent, monthLabel);

    return {
      spent,
      budget,
      deltaVsLastMonth,
      pacePhrase: phrase,
      daysUntilPayday,
      timeElapsedPercent,
      monthLabel,
    };
  });

  const cashFlow = safe<HomeCashFlow>("cashFlow", errors, () =>
    getCashFlow(workspaceId, selected.from, selected.to)
  );

  const categorySnapshot = safe<HomeCategorySnapshotItem[]>(
    "categorySnapshot",
    errors,
    () =>
      getCategorySnapshot(
        workspaceId,
        selected.from,
        selected.to,
        CATEGORY_SNAPSHOT_LIMIT
      )
  );

  const historicalTrend = safe<HomeHistoricalTrendPoint[]>(
    "historicalTrend",
    errors,
    () => getCashFlowTrend(workspaceId, selected, TREND_MONTHS, now)
  );

  const recentTransactions = safe<HomeRecentTransaction[]>(
    "recentTransactions",
    errors,
    () => getRecentTransactionsForHome(workspaceId, RECENT_TXN_LIMIT)
  );

  const spendingStats = safe<HomeSpendingStats>("spendingStats", errors, () => {
    const statsTo = toLocalISODate(getLastCompleteMonthEnd(now));
    return getSpendingStats(workspaceId, statsTo, STATS_DEFAULT_MONTHS);
  });

  const needsAttention = safe<HomeNeedsAttention>(
    "needsAttention",
    errors,
    () => getNeedsAttentionCounts(workspaceId)
  );

  const bankHealth = safe<HomeBankHealthItem[]>("bankHealth", errors, () =>
    getBankHealth(workspaceId)
  );

  const payload: HomePayload = {
    month: selected.key,
    kpis,
    budgetPace,
    thisMonth,
    cashFlow,
    categorySnapshot,
    historicalTrend,
    recentTransactions,
    spendingStats,
    needsAttention,
    bankHealth,
    nextScheduledSync: getNextRunAt(),
    errors,
  };

  return NextResponse.json(payload);
}
```

- [ ] **Step 7: Update the client**

In `src/lib/api.ts`, replace `getHome`:

```ts
export function getHome(month?: string) {
  const qs = month ? `?month=${encodeURIComponent(month)}` : "";
  return fetchJSON<HomePayload>(`/api/home${qs}`);
}
```

In `src/components/home/home-page.tsx`:
- Replace `queryFn: getHome,` with `queryFn: () => getHome(),`
- In the `skeletonLabels` object, add before the `thisMonth:` line:

```ts
      kpis: t("cashFlowTitle"),
      budgetPace: t("budgetPaceTitle"),
```

- In `renderCard`, add as the first cases of the `switch`:

```tsx
    case "kpis":
    case "budgetPace":
      // Not placed in the grid yet.
      return null;
```

- In `SKELETON_HEIGHTS`, add before `thisMonth: 180,`:

```ts
  kpis: 120,
  budgetPace: 180,
```

In `src/components/home/historical-trend-card.tsx` (it is deleted in Task 6, this keeps it compiling with locale labels):
- Replace `import { useTranslations } from "next-intl";` with `import { useLocale, useTranslations } from "next-intl";`
- Replace `import { formatCurrency } from "@/lib/formatters";` with:

```ts
import { formatCurrency, formatMonthKey } from "@/lib/formatters";
import type { Locale } from "@/i18n/routing";
```

- Replace both `t("last6Months")` with `t("trendTitle")`.
- In `HistoricalTrendCard`, after `const t = useTranslations("home");`, add `const locale = useLocale() as Locale;`
- Replace `{active.label}` with `{formatMonthKey(active.month, locale, "short", false)}`.
- In `BarChart`, before `const width = 100;`, add `const locale = useLocale() as Locale;`
- Replace `{d.label}` with `{formatMonthKey(d.month, locale, "short", false)}`.

- [ ] **Step 8: Add the i18n strings**

In `src/i18n/messages/en.json`, directly after `"pageTitle": "Home",` add:

```json
    "trendTitle": "12-month cash flow",
    "budgetPaceTitle": "Budget pace",
```

In `src/i18n/messages/he.json`, directly after `"pageTitle": "בית",` add:

```json
    "trendTitle": "תזרים מזומנים ל-12 חודשים",
    "budgetPaceTitle": "קצב תקציב",
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `node --conditions react-server --experimental-transform-types --test scripts/test-home-analytics.mjs`
Expected: PASS, all tests.

Run: `npm run test:logic`
Expected: PASS.

- [ ] **Step 10: Type check, lint, build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 11: Check the API by hand**

Start the app on the demo data dir (see "Manual QA environment"), then in PowerShell:

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" "http://127.0.0.1:3000/api/home?month=2026-13"
curl.exe -s -o NUL -w "%{http_code}`n" "http://127.0.0.1:3000/api/home?month=2099-01"
curl.exe -s "http://127.0.0.1:3000/api/home" | Select-String '"kpis"'
```

Expected: `400`, `400`, and a line containing `"kpis"`. Pick a past month from the demo data (for example two months ago) and confirm `"month":"YYYY-MM"` and `"isPast":true` in `curl.exe -s "http://127.0.0.1:3000/api/home?month=YYYY-MM"`. Open Home in the browser: the old cards still render, and the trend card shows 12 locale-formatted months in both English and Hebrew.

- [ ] **Step 12: Commit**

```bash
git add src/server/lib/home-analytics.ts src/server/db/queries/home.ts src/lib/types.ts src/app/api/home/route.ts src/lib/api.ts src/components/home/home-page.tsx src/components/home/historical-trend-card.tsx src/i18n/messages/en.json src/i18n/messages/he.json scripts/test-home-analytics.mjs
git diff --cached   # read it: synthetic values only
git commit -F - <<'EOF'
feat: compute home KPIs, 12-month trend and budget pace per month

GET /api/home now accepts ?month=YYYY-MM. Invalid formats and future
months return 400. New sections, each wrapped in safe():

- kpis: income, expenses, net and savings rate for the month, the
  previous-month comparison (same days for the current month, full month
  otherwise) and the average of up to 6 completed months before it.
  They reuse getCashFlow, so they follow the existing home semantics:
  completed rows only, Transfers and card-bill transfers excluded.
- historicalTrend: 12 months ending at the selected month, flagged with
  isSelected, without server-built English labels.
- budgetPace: spent vs monthly_target with isPast, and no payday for
  past months.

The trend card formats month labels in the active locale until the new
chart replaces it. Legacy sections stay until their cards are replaced.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Category breakdown data

**Files:**
- Create: `src/lib/home-category-breakdown.ts`
- Modify: `src/lib/types.ts` (breakdown types, section, payload)
- Modify: `src/server/db/queries/home.ts` (add `getCategoryBreakdown`)
- Modify: `src/app/api/home/route.ts`
- Modify: `src/components/home/home-page.tsx` (section maps)
- Modify: `src/i18n/messages/en.json`, `he.json`
- Test: `scripts/test-home-analytics.mjs`

**Interfaces:**
- Consumes (Tasks 1, 2): `HomeMonthRange`, `getAverageWindow`, `HOME_AVERAGE_MONTHS`, `getFirstActivityMonth`, the Task 2 test fixture (`getHomeFixture`, `FIXTURE_NOW`).
- Produces (`src/lib/types.ts`):
  - `HomeCategoryBreakdownChild { categoryId: number; name: string; color: string; amount: number; share: number }`
  - `HomeCategoryBreakdownGroup { categoryId: number | null; name: string | null; color: string | null; amount: number; share: number; avg6: number | null; categoryIds: number[]; children: HomeCategoryBreakdownChild[] }`
  - `HomeCategoryBreakdown { month: string; isCurrentMonth: boolean; total: number; averageMonths: number; groups: HomeCategoryBreakdownGroup[] }`
  - `HomeSection` gains `"categoryBreakdown"`; `HomePayload` gains `categoryBreakdown: HomeCategoryBreakdown | null`.
- Produces (`src/lib/home-category-breakdown.ts`):
  - `interface BreakdownCategory { id: number; parentId: number | null; name: string; color: string }`
  - `interface BreakdownSpendRow { categoryId: number | null; amount: number }`
  - `buildCategoryBreakdown(input: { month: string; isCurrentMonth: boolean; categories: BreakdownCategory[]; monthRows: BreakdownSpendRow[]; averageRows: BreakdownSpendRow[]; averageMonths: number }): HomeCategoryBreakdown`
  - `interface DonutSlice { key: string; categoryId: number | null; name: string | null; color: string | null; amount: number; share: number; isOther: boolean }`
  - `foldBreakdownForDonut(groups: HomeCategoryBreakdownGroup[], maxSlices: number): DonutSlice[]`
  - `categoryDeltaVsAverage(amount: number, avg6: number | null): number | null`
- Produces (`src/server/db/queries/home.ts`): `getCategoryBreakdown(workspaceId: number, month: HomeMonthRange): HomeCategoryBreakdown`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-home-analytics.mjs`:

```js
test("category breakdown falls back to leaf categories when there are no parent groups", async () => {
  const { buildCategoryBreakdown } = await import("../src/lib/home-category-breakdown.ts");

  const breakdown = buildCategoryBreakdown({
    month: "2026-09",
    isCurrentMonth: false,
    categories: [
      { id: 1, parentId: null, name: "Groceries", color: "#8FBC8A" },
      { id: 2, parentId: null, name: "Fuel", color: "#7D90CA" },
    ],
    monthRows: [
      { categoryId: 2, amount: 300 },
      { categoryId: 1, amount: 700 },
    ],
    averageRows: [{ categoryId: 1, amount: 1800 }],
    averageMonths: 3,
  });

  assert.deepEqual(breakdown, {
    month: "2026-09",
    isCurrentMonth: false,
    total: 1000,
    averageMonths: 3,
    groups: [
      { categoryId: 1, name: "Groceries", color: "#8FBC8A", amount: 700, share: 0.7, avg6: 600, categoryIds: [1], children: [] },
      { categoryId: 2, name: "Fuel", color: "#7D90CA", amount: 300, share: 0.3, avg6: 0, categoryIds: [2], children: [] },
    ],
  });
});

test("category breakdown keeps spend on a parent itself and buckets unknown or missing categories as uncategorized", async () => {
  const { buildCategoryBreakdown } = await import("../src/lib/home-category-breakdown.ts");

  const breakdown = buildCategoryBreakdown({
    month: "2026-09",
    isCurrentMonth: true,
    categories: [
      { id: 1, parentId: null, name: "Food", color: "#E7A875" },
      { id: 2, parentId: 1, name: "Groceries", color: "#8FBC8A" },
    ],
    monthRows: [
      { categoryId: 1, amount: 100 },
      { categoryId: 2, amount: 300 },
      { categoryId: null, amount: 60 },
      { categoryId: 99, amount: 40 },
    ],
    averageRows: [],
    averageMonths: 0,
  });

  assert.deepEqual(breakdown.groups, [
    {
      categoryId: 1, name: "Food", color: "#E7A875", amount: 400, share: 0.8, avg6: null,
      categoryIds: [1, 2],
      children: [{ categoryId: 2, name: "Groceries", color: "#8FBC8A", amount: 300, share: 0.6 }],
    },
    { categoryId: null, name: null, color: null, amount: 100, share: 0.2, avg6: null, categoryIds: [], children: [] },
  ]);
  assert.equal(breakdown.total, 500);

  const empty = buildCategoryBreakdown({
    month: "2026-09", isCurrentMonth: false, categories: [], monthRows: [], averageRows: [], averageMonths: 0,
  });
  assert.deepEqual(empty, { month: "2026-09", isCurrentMonth: false, total: 0, averageMonths: 0, groups: [] });
});

test("donut folds the smallest groups into Other and deltas compare to the average", async () => {
  const { categoryDeltaVsAverage, foldBreakdownForDonut } = await import("../src/lib/home-category-breakdown.ts");
  const amounts = [900, 800, 700, 600, 500, 400, 300, 200, 100];
  const groups = amounts.map((amount, index) => ({
    categoryId: index + 1,
    name: `Group ${index + 1}`,
    color: "#111111",
    amount,
    share: amount / 4500,
    avg6: null,
    categoryIds: [index + 1],
    children: [],
  }));

  const slices = foldBreakdownForDonut(groups, 7);
  assert.equal(slices.length, 7);
  assert.deepEqual(slices.slice(0, 6).map((slice) => slice.amount), [900, 800, 700, 600, 500, 400]);
  assert.equal(slices[0].key, "c1");
  assert.equal(slices[6].key, "other");
  assert.equal(slices[6].isOther, true);
  assert.equal(slices[6].amount, 600);
  assert.equal(Math.round(slices[6].share * 1e6), Math.round((600 / 4500) * 1e6));
  assert.equal(foldBreakdownForDonut(groups.slice(0, 3), 7).length, 3);

  assert.equal(categoryDeltaVsAverage(1200, 1000), 20);
  assert.equal(categoryDeltaVsAverage(800, 1000), -20);
  assert.equal(categoryDeltaVsAverage(500, 0), null);
  assert.equal(categoryDeltaVsAverage(500, null), null);
});

test("home category breakdown rolls leaves into parent groups and sums to the expense KPI", async () => {
  const { workspaceId, categories: c } = await getHomeFixture();
  const { getCategoryBreakdown, getHomeKpis } = await import("../src/server/db/queries/home.ts");
  const { buildHomeMonthRange } = await import("../src/lib/home-month.ts");
  const october = buildHomeMonthRange("2026-10", FIXTURE_NOW);

  const breakdown = getCategoryBreakdown(workspaceId, october);

  assert.deepEqual(breakdown, {
    month: "2026-10",
    isCurrentMonth: true,
    total: 600,
    averageMonths: 4,
    groups: [
      {
        categoryId: c.food, name: "Food", color: "#E7A875", amount: 400, share: 400 / 600,
        avg6: 15500 / 4, categoryIds: [c.groceries, c.restaurants],
        children: [
          { categoryId: c.groceries, name: "Groceries", color: "#8FBC8A", amount: 250, share: 250 / 600 },
          { categoryId: c.restaurants, name: "Restaurants", color: "#E29C71", amount: 150, share: 150 / 600 },
        ],
      },
      {
        categoryId: c.utilities, name: "Utilities", color: "#7D90CA", amount: 120, share: 120 / 600,
        avg6: 4500 / 4, categoryIds: [c.utilities], children: [],
      },
      { categoryId: null, name: null, color: null, amount: 80, share: 80 / 600, avg6: 0, categoryIds: [], children: [] },
    ],
  });

  const groupTotal = breakdown.groups.reduce((sum, group) => sum + group.amount, 0);
  assert.equal(groupTotal, getHomeKpis(workspaceId, october).expenses);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --conditions react-server --experimental-transform-types --test scripts/test-home-analytics.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `home-category-breakdown.ts` and `getCategoryBreakdown is not a function`.

- [ ] **Step 3: Add the types to `src/lib/types.ts`**

In the `HomeSection` union, add `| "categoryBreakdown"` directly after `| "budgetPace"`.

Directly after the `HomeBudgetPace` interface, add:

```ts
export interface HomeCategoryBreakdownChild {
  categoryId: number;
  name: string;
  color: string;
  amount: number;
  /** 0..1 share of the month's expenses */
  share: number;
}

export interface HomeCategoryBreakdownGroup {
  /** Parent group id, or the leaf id when it has no parent. Null is the uncategorized bucket. */
  categoryId: number | null;
  name: string | null;
  color: string | null;
  amount: number;
  /** 0..1 share of the month's expenses */
  share: number;
  /** Mean monthly spend over the average window, or null when there is no window. */
  avg6: number | null;
  /** Category ids whose rows make up this group in the month, used for /transactions links. */
  categoryIds: number[];
  children: HomeCategoryBreakdownChild[];
}

export interface HomeCategoryBreakdown {
  month: string;
  isCurrentMonth: boolean;
  total: number;
  averageMonths: number;
  groups: HomeCategoryBreakdownGroup[];
}
```

In `HomePayload`, add `categoryBreakdown: HomeCategoryBreakdown | null;` directly after `budgetPace: HomeBudgetPace | null;`.

- [ ] **Step 4: Create `src/lib/home-category-breakdown.ts`**

```ts
import type {
  HomeCategoryBreakdown,
  HomeCategoryBreakdownChild,
  HomeCategoryBreakdownGroup,
} from "./types";

export interface BreakdownCategory {
  id: number;
  parentId: number | null;
  name: string;
  color: string;
}

export interface BreakdownSpendRow {
  categoryId: number | null;
  amount: number;
}

export interface DonutSlice {
  key: string;
  categoryId: number | null;
  name: string | null;
  color: string | null;
  amount: number;
  share: number;
  isOther: boolean;
}

interface GroupAccumulator {
  amount: number;
  categoryIds: Set<number>;
  children: Map<number, number>;
}

export function buildCategoryBreakdown(input: {
  month: string;
  isCurrentMonth: boolean;
  categories: BreakdownCategory[];
  monthRows: BreakdownSpendRow[];
  averageRows: BreakdownSpendRow[];
  averageMonths: number;
}): HomeCategoryBreakdown {
  const byId = new Map(input.categories.map((category) => [category.id, category]));

  // A leaf rolls up to its parent; a category without a parent is its own
  // group, so a workspace with no parent groups falls back to leaves.
  // Unknown ids join the uncategorized bucket so totals still add up.
  const groupIdFor = (categoryId: number | null): number | null => {
    if (categoryId == null) return null;
    const category = byId.get(categoryId);
    if (!category) return null;
    if (category.parentId != null && byId.has(category.parentId)) {
      return category.parentId;
    }
    return category.id;
  };

  const total = input.monthRows.reduce((sum, row) => sum + row.amount, 0);
  const shareOf = (amount: number) => (total > 0 ? amount / total : 0);

  const accumulators = new Map<number | null, GroupAccumulator>();
  for (const row of input.monthRows) {
    if (row.amount === 0) continue;
    const groupId = groupIdFor(row.categoryId);
    const group = accumulators.get(groupId) ?? {
      amount: 0,
      categoryIds: new Set<number>(),
      children: new Map<number, number>(),
    };
    group.amount += row.amount;
    if (groupId != null && row.categoryId != null) {
      group.categoryIds.add(row.categoryId);
      if (row.categoryId !== groupId) {
        group.children.set(
          row.categoryId,
          (group.children.get(row.categoryId) ?? 0) + row.amount
        );
      }
    }
    accumulators.set(groupId, group);
  }

  const averageTotals = new Map<number | null, number>();
  for (const row of input.averageRows) {
    const groupId = groupIdFor(row.categoryId);
    averageTotals.set(groupId, (averageTotals.get(groupId) ?? 0) + row.amount);
  }

  const groups: HomeCategoryBreakdownGroup[] = [];
  for (const [groupId, group] of accumulators) {
    const category = groupId != null ? byId.get(groupId) : undefined;
    const children: HomeCategoryBreakdownChild[] = [];
    for (const [childId, amount] of group.children) {
      const child = byId.get(childId);
      if (!child) continue;
      children.push({
        categoryId: childId,
        name: child.name,
        color: child.color,
        amount,
        share: shareOf(amount),
      });
    }
    children.sort((a, b) => b.amount - a.amount);

    groups.push({
      categoryId: groupId,
      name: category?.name ?? null,
      color: category?.color ?? null,
      amount: group.amount,
      share: shareOf(group.amount),
      avg6:
        input.averageMonths > 0
          ? (averageTotals.get(groupId) ?? 0) / input.averageMonths
          : null,
      categoryIds: [...group.categoryIds].sort((a, b) => a - b),
      children,
    });
  }
  groups.sort((a, b) => b.amount - a.amount);

  return {
    month: input.month,
    isCurrentMonth: input.isCurrentMonth,
    total,
    averageMonths: input.averageMonths,
    groups,
  };
}

/** Keeps the largest groups and folds the rest into one "Other" slice. */
export function foldBreakdownForDonut(
  groups: HomeCategoryBreakdownGroup[],
  maxSlices: number
): DonutSlice[] {
  const slices: DonutSlice[] = groups.map((group) => ({
    key: group.categoryId == null ? "uncategorized" : `c${group.categoryId}`,
    categoryId: group.categoryId,
    name: group.name,
    color: group.color,
    amount: group.amount,
    share: group.share,
    isOther: false,
  }));
  if (slices.length <= maxSlices) return slices;

  const kept = slices.slice(0, maxSlices - 1);
  const rest = slices.slice(maxSlices - 1);
  return [
    ...kept,
    {
      key: "other",
      categoryId: null,
      name: null,
      color: null,
      amount: rest.reduce((sum, slice) => sum + slice.amount, 0),
      share: rest.reduce((sum, slice) => sum + slice.share, 0),
      isOther: true,
    },
  ];
}

export function categoryDeltaVsAverage(
  amount: number,
  avg6: number | null
): number | null {
  if (avg6 == null || avg6 <= 0) return null;
  return ((amount - avg6) / avg6) * 100;
}
```

- [ ] **Step 5: Add `getCategoryBreakdown` to `src/server/db/queries/home.ts`**

Add to the imports:

```ts
import {
  buildCategoryBreakdown,
  type BreakdownCategory,
  type BreakdownSpendRow,
} from "@/lib/home-category-breakdown";
```

and add `HomeCategoryBreakdown,` to the `@/lib/types` type import list (alphabetical, after `HomeCashFlow,`).

Directly after `getBudgetPace`, add:

```ts
export function getCategoryBreakdown(
  workspaceId: number,
  month: HomeMonthRange
): HomeCategoryBreakdown {
  const db = getDb();
  const categories = db
    .prepare(
      `SELECT id, parent_id as parentId, name, color
       FROM categories WHERE workspace_id = ?`
    )
    .all(workspaceId) as BreakdownCategory[];

  // Same filters as the Expenses KPI, so the groups add up to it.
  const spendStmt = db.prepare(
    `SELECT t.category_id as categoryId, SUM(ABS(t.charged_amount)) as amount
     FROM transactions t
     WHERE t.workspace_id = ? AND t.date >= ? AND t.date <= ?
       AND t.status = 'completed' AND t.kind = 'expense'
       AND ${HOME_CATEGORY_SOURCE_SQL}
       AND ${EXCLUDE_TRANSFERS_SQL}
     GROUP BY t.category_id`
  );
  const monthRows = spendStmt.all(
    workspaceId,
    month.from,
    month.to,
    ...HOME_CATEGORY_SOURCE_PROVIDERS
  ) as BreakdownSpendRow[];

  const window = getAverageWindow(
    month,
    getFirstActivityMonth(workspaceId),
    HOME_AVERAGE_MONTHS
  );
  const averageRows = window
    ? (spendStmt.all(
        workspaceId,
        window.from,
        window.to,
        ...HOME_CATEGORY_SOURCE_PROVIDERS
      ) as BreakdownSpendRow[])
    : [];

  return buildCategoryBreakdown({
    month: month.key,
    isCurrentMonth: month.isCurrent,
    categories,
    monthRows,
    averageRows,
    averageMonths: window?.months.length ?? 0,
  });
}
```

- [ ] **Step 6: Wire the route**

In `src/app/api/home/route.ts`:
- Add `getCategoryBreakdown,` to the `@/server/db/queries/home` import list, after `getCashFlowTrend,`.
- Add `HomeCategoryBreakdown,` to the type import list, after `HomeBudgetPace,`.
- Directly after the `categorySnapshot` `safe()` block, add:

```ts
  const categoryBreakdown = safe<HomeCategoryBreakdown>(
    "categoryBreakdown",
    errors,
    () => getCategoryBreakdown(workspaceId, selected)
  );
```

- In `payload`, add `categoryBreakdown,` directly after `categorySnapshot,`.

- [ ] **Step 7: Keep `home-page.tsx` compiling and add the string**

In `src/components/home/home-page.tsx`:
- In `skeletonLabels`, add `categoryBreakdown: t("whereMoneyWent"),` after `budgetPace: t("budgetPaceTitle"),`.
- In `renderCard`, change the first null group to:

```tsx
    case "kpis":
    case "budgetPace":
    case "categoryBreakdown":
      // Not placed in the grid yet.
      return null;
```

- In `SKELETON_HEIGHTS`, add `categoryBreakdown: 260,` after `budgetPace: 180,`.

In `en.json`, directly after `"pageTitle": "Home",` add:

```json
    "whereMoneyWent": "Where money went",
```

In `he.json`, directly after `"pageTitle": "בית",` add:

```json
    "whereMoneyWent": "לאן הלך הכסף",
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --conditions react-server --experimental-transform-types --test scripts/test-home-analytics.mjs`
Expected: PASS.

Run: `npm run test:logic`
Expected: PASS.

- [ ] **Step 9: Type check and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/lib/home-category-breakdown.ts src/lib/types.ts src/server/db/queries/home.ts src/app/api/home/route.ts src/components/home/home-page.tsx src/i18n/messages/en.json src/i18n/messages/he.json scripts/test-home-analytics.mjs
git diff --cached   # read it: synthetic values only
git commit -F - <<'EOF'
feat: add the category breakdown section to the home API

Where money went needs spend per parent category group for the selected
month, each group's share of expenses and its average over the same
6-month window as the KPI tiles.

- buildCategoryBreakdown rolls leaves into their parent group, keeps a
  leaf as its own group when it has no parent (so workspaces without
  groups fall back to leaves) and puts rows without a known category in
  an uncategorized bucket. The query uses the Expenses KPI filters, so
  the groups add up to the Expenses tile; a test pins that.
- Each group lists the category ids behind it so the UI can link to
  /transactions filtered to exactly those rows.
- foldBreakdownForDonut folds small groups into Other for the chart.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Needs attention fixes and filtered `/transactions` links

**Files:**
- Modify: `src/lib/transaction-review-filter.ts` (full rewrite below)
- Create: `src/lib/transactions-url.ts`
- Create: `src/lib/home-needs-attention.ts`
- Modify: `src/server/db/queries/home.ts:296-324` (`getNeedsAttentionCounts`)
- Modify: `src/server/db/queries/transactions.ts:160-175,307-309` (filters)
- Modify: `src/app/api/transactions/route.ts:44-66`
- Modify: `src/lib/api.ts:240-256` (`getTransactions` params)
- Modify: `src/server/sync/categorization.ts:354`, `src/app/api/categorize/apply/route.ts:78` (shared threshold)
- Modify: `src/components/transactions/transactions-page.tsx`
- Modify: `src/components/home/needs-attention-card.tsx` (full rewrite below)
- Modify: `src/components/home/home-page.tsx` (pass `month`)
- Modify: `src/app/api/home/route.ts` (month range for needs attention)
- Modify: `src/i18n/messages/en.json`, `he.json` (`transactions` namespace)
- Test: `scripts/test-transaction-review-filter.mjs`, `scripts/test-home-analytics.mjs`

**Interfaces:**
- Consumes (Task 1): `isValidMonthKey`, `monthKeyToDate`.
- Produces (`src/lib/transaction-review-filter.ts`):
  - `type TransactionReviewFilter = "all" | "pending" | "uncategorized" | "lowConfidence"`
  - `LOW_CONFIDENCE_MAX = 4`
  - `parseReviewFilter(raw: string | null): TransactionReviewFilter`
  - `reviewFilterQuery(filter): { needsReview?: true; uncategorized?: true; lowConfidence?: true }`
  - `isPendingReviewFilter`, `serializeReviewFilter` unchanged.
- Produces (`src/lib/transactions-url.ts`):
  - `interface TransactionsUrlState { month: string | null; categoryIds: number[]; kind: TransactionKindFilter | null; review: TransactionReviewFilter; source: TransactionSourceType | null }`
  - `buildTransactionsHref(state: Partial<TransactionsUrlState>): string`
  - `parseTransactionsUrlState(params: Pick<URLSearchParams, "get" | "getAll">): TransactionsUrlState`
- Produces (`src/lib/home-needs-attention.ts`):
  - `type NeedsAttentionRowId = "uncategorized" | "lowConfidence" | "flagged"` (the trips plan adds `"needsTrip"`)
  - `interface NeedsAttentionRow { id: NeedsAttentionRowId; count: number; href: string }`
  - `buildNeedsAttentionRows(data: HomeNeedsAttention, month: string): NeedsAttentionRow[]`
- Produces (`src/server/db/queries/home.ts`): `getNeedsAttentionCounts(workspaceId: number, range?: { from: string; to: string }): HomeNeedsAttention`
- Produces (`QueryParams` in transactions.ts and `getTransactions` params): `uncategorized?: boolean`, `lowConfidence?: boolean`
- Produces (`NeedsAttentionCard`): props `{ data: HomeNeedsAttention; month: string }`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-transaction-review-filter.mjs`:

```js
test("review filters parse from the URL and map to query flags", () => {
  assert.equal(reviewFilters.LOW_CONFIDENCE_MAX, 4);
  assert.equal(reviewFilters.parseReviewFilter("pending"), "pending");
  assert.equal(reviewFilters.parseReviewFilter("uncategorized"), "uncategorized");
  assert.equal(reviewFilters.parseReviewFilter("lowConfidence"), "lowConfidence");
  assert.equal(reviewFilters.parseReviewFilter("bogus"), "all");
  assert.equal(reviewFilters.parseReviewFilter(null), "all");

  assert.deepEqual(reviewFilters.reviewFilterQuery("all"), {});
  assert.deepEqual(reviewFilters.reviewFilterQuery("pending"), { needsReview: true });
  assert.deepEqual(reviewFilters.reviewFilterQuery("uncategorized"), { uncategorized: true });
  assert.deepEqual(reviewFilters.reviewFilterQuery("lowConfidence"), { lowConfidence: true });
});
```

Append to `scripts/test-home-analytics.mjs`:

```js
test("transactions links round-trip month, categories, kind, review and source", async () => {
  const { buildTransactionsHref, parseTransactionsUrlState } = await import("../src/lib/transactions-url.ts");

  assert.equal(
    buildTransactionsHref({ month: "2026-09", categoryIds: [4, 7], kind: "expense", source: "all" }),
    "/transactions?month=2026-09&category=4&category=7&kind=expense&source=all"
  );
  assert.equal(buildTransactionsHref({}), "/transactions");

  assert.deepEqual(
    parseTransactionsUrlState(
      new URLSearchParams("month=2026-09&category=4&category=x&category=-1&category=7&kind=expense&review=lowConfidence&source=all")
    ),
    { month: "2026-09", categoryIds: [4, 7], kind: "expense", review: "lowConfidence", source: "all" }
  );
  assert.deepEqual(
    parseTransactionsUrlState(new URLSearchParams("month=2026-13&kind=bogus&source=moon&review=nope")),
    { month: null, categoryIds: [], kind: null, review: "all", source: null }
  );
});

test("needs attention rows link to the matching /transactions review filters", async () => {
  const { buildNeedsAttentionRows } = await import("../src/lib/home-needs-attention.ts");

  assert.deepEqual(buildNeedsAttentionRows({ uncategorized: 2, lowConfidence: 1, flagged: 3 }, "2026-09"), [
    { id: "uncategorized", count: 2, href: "/transactions?month=2026-09&kind=expense&review=uncategorized&source=all" },
    { id: "lowConfidence", count: 1, href: "/transactions?month=2026-09&kind=all&review=lowConfidence&source=all" },
    { id: "flagged", count: 3, href: "/transactions?month=2026-09&kind=all&review=pending&source=all" },
  ]);
});

// Workspace 3: invented review queue in September 2026.
let reviewFixturePromise;
function getReviewFixture() {
  reviewFixturePromise ??= seedReviewFixture();
  return reviewFixturePromise;
}

async function seedReviewFixture() {
  const { getDb } = await import("../src/server/db/index.ts");
  const db = getDb();
  const workspaceId = 3;
  db.prepare(
    `INSERT INTO workspaces (id, name, slug) VALUES (?, 'Review fixture', 'review-fixture')`
  ).run(workspaceId);
  const syncRunId = db
    .prepare(
      `INSERT INTO sync_runs (workspace_id, provider, started_at, status, scrape_from_date)
       VALUES (?, 'test', '2026-08-01', 'completed', '2026-08-01')`
    )
    .run(workspaceId).lastInsertRowid;
  const groceries = Number(
    db
      .prepare(
        `INSERT INTO categories (workspace_id, name, color, kind) VALUES (?, 'Groceries', '#8FBC8A', 'expense')`
      )
      .run(workspaceId).lastInsertRowid
  );
  const insert = db.prepare(
    `INSERT INTO transactions
       (workspace_id, account_number, date, processed_date, original_amount,
        original_currency, charged_amount, description, type, status, provider,
        sync_run_id, dedup_hash, kind, category_id, category_source, ai_confidence, needs_review)
     VALUES (?, 'acct', ?, ?, -100, 'ILS', -100, ?, 'normal', 'completed', 'isracard_bill',
             ?, ?, 'expense', ?, ?, ?, ?)`
  );
  const rows = [
    ["2026-09-05", "Uncategorized row", null, null, null, 0],
    ["2026-09-06", "Low confidence row", groceries, "ai", 3, 1],
    ["2026-09-07", "Approved low confidence row", groceries, "ai", 2, 0],
    ["2026-09-08", "Confident row", groceries, "ai", 6, 0],
    ["2026-09-09", "Flagged without confidence row", groceries, "ai", null, 1],
    ["2026-08-20", "Older uncategorized row", null, null, null, 0],
  ];
  rows.forEach(([date, description, categoryId, source, confidence, needsReview], index) => {
    insert.run(workspaceId, date, date, description, syncRunId, `review-${index}`,
      categoryId, source, confidence, needsReview);
  });
  return { workspaceId };
}

test("needs attention counts low confidence on the 1-7 scale, skips approved rows, and can scope to a month", async () => {
  const { workspaceId } = await getReviewFixture();
  const { getNeedsAttentionCounts } = await import("../src/server/db/queries/home.ts");

  assert.deepEqual(
    getNeedsAttentionCounts(workspaceId, { from: "2026-09-01", to: "2026-09-30" }),
    { uncategorized: 1, lowConfidence: 1, flagged: 2 }
  );
  assert.deepEqual(getNeedsAttentionCounts(workspaceId), {
    uncategorized: 2,
    lowConfidence: 1,
    flagged: 2,
  });
});

test("transaction list filters return exactly the uncategorized and low-confidence rows", async () => {
  const { workspaceId } = await getReviewFixture();
  const { queryTransactions } = await import("../src/server/db/queries/transactions.ts");
  const september = { from: "2026-09-01", to: "2026-09-30" };

  const lowConfidence = queryTransactions(workspaceId, { ...september, lowConfidence: true });
  assert.equal(lowConfidence.total, 1);
  assert.equal(lowConfidence.transactions[0].description, "Low confidence row");

  const uncategorized = queryTransactions(workspaceId, { ...september, uncategorized: true });
  assert.equal(uncategorized.total, 1);
  assert.equal(uncategorized.transactions[0].description, "Uncategorized row");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --conditions react-server --experimental-transform-types --test scripts/test-transaction-review-filter.mjs scripts/test-home-analytics.mjs`
Expected: FAIL. `parseReviewFilter is not a function`; `ERR_MODULE_NOT_FOUND` for `transactions-url.ts` and `home-needs-attention.ts`; the counts test reports `lowConfidence: 0` (the old `< 0.5` threshold) and ignores the range; the list filters return every September row.

- [ ] **Step 3: Rewrite `src/lib/transaction-review-filter.ts`**

```ts
export type TransactionReviewFilter =
  | "all"
  | "pending"
  | "uncategorized"
  | "lowConfidence";

/**
 * AI confidence is on a 1-7 scale. Results at or below this value are
 * flagged for review during categorization and counted as low confidence.
 */
export const LOW_CONFIDENCE_MAX = 4;

const REVIEW_FILTERS: readonly TransactionReviewFilter[] = [
  "all",
  "pending",
  "uncategorized",
  "lowConfidence",
];

export function isPendingReviewFilter(
  filter: TransactionReviewFilter
): boolean {
  return filter === "pending";
}

export function serializeReviewFilter(
  filter: TransactionReviewFilter
): string | null {
  return isPendingReviewFilter(filter) ? "true" : null;
}

export function parseReviewFilter(raw: string | null): TransactionReviewFilter {
  return REVIEW_FILTERS.find((filter) => filter === raw) ?? "all";
}

export function reviewFilterQuery(filter: TransactionReviewFilter): {
  needsReview?: true;
  uncategorized?: true;
  lowConfidence?: true;
} {
  switch (filter) {
    case "pending":
      return { needsReview: true };
    case "uncategorized":
      return { uncategorized: true };
    case "lowConfidence":
      return { lowConfidence: true };
    default:
      return {};
  }
}
```

- [ ] **Step 4: Create `src/lib/transactions-url.ts`**

```ts
import { isValidMonthKey } from "./home-month";
import {
  parseReviewFilter,
  type TransactionReviewFilter,
} from "./transaction-review-filter";
import type { TransactionKindFilter } from "./api";
import type { TransactionSourceType } from "./transaction-source-types";

export interface TransactionsUrlState {
  /** "YYYY-MM" */
  month: string | null;
  categoryIds: number[];
  kind: TransactionKindFilter | null;
  review: TransactionReviewFilter;
  source: TransactionSourceType | null;
}

const KINDS: readonly TransactionKindFilter[] = ["expense", "income", "all"];
const SOURCES: readonly TransactionSourceType[] = ["all", "bank", "card"];

export function buildTransactionsHref(state: Partial<TransactionsUrlState>): string {
  const params = new URLSearchParams();
  if (state.month) params.set("month", state.month);
  for (const id of state.categoryIds ?? []) params.append("category", String(id));
  if (state.kind) params.set("kind", state.kind);
  if (state.review && state.review !== "all") params.set("review", state.review);
  if (state.source) params.set("source", state.source);
  const query = params.toString();
  return query ? `/transactions?${query}` : "/transactions";
}

export function parseTransactionsUrlState(
  params: Pick<URLSearchParams, "get" | "getAll">
): TransactionsUrlState {
  const month = params.get("month");
  const kind = params.get("kind");
  const source = params.get("source");
  return {
    month: isValidMonthKey(month) ? month : null,
    categoryIds: params
      .getAll("category")
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0),
    kind: KINDS.find((value) => value === kind) ?? null,
    review: parseReviewFilter(params.get("review")),
    source: SOURCES.find((value) => value === source) ?? null,
  };
}
```

- [ ] **Step 5: Create `src/lib/home-needs-attention.ts`**

```ts
import { buildTransactionsHref } from "./transactions-url";
import type { HomeNeedsAttention } from "./types";

export type NeedsAttentionRowId = "uncategorized" | "lowConfidence" | "flagged";

export interface NeedsAttentionRow {
  id: NeedsAttentionRowId;
  count: number;
  href: string;
}

/**
 * Rows for the Needs attention card, in display order. Adding a row (for
 * example the trips queue) means adding an id here and its icon and label
 * in the card.
 */
export function buildNeedsAttentionRows(
  data: HomeNeedsAttention,
  month: string
): NeedsAttentionRow[] {
  return [
    {
      id: "uncategorized",
      count: data.uncategorized,
      href: buildTransactionsHref({ month, kind: "expense", review: "uncategorized", source: "all" }),
    },
    {
      id: "lowConfidence",
      count: data.lowConfidence,
      href: buildTransactionsHref({ month, kind: "all", review: "lowConfidence", source: "all" }),
    },
    {
      id: "flagged",
      count: data.flagged,
      href: buildTransactionsHref({ month, kind: "all", review: "pending", source: "all" }),
    },
  ];
}
```

- [ ] **Step 6: Fix the counts in `src/server/db/queries/home.ts`**

Add to the imports:

```ts
import { LOW_CONFIDENCE_MAX } from "@/lib/transaction-review-filter";
```

Replace the whole `getNeedsAttentionCounts` function with:

```ts
export function getNeedsAttentionCounts(
  workspaceId: number,
  range?: { from: string; to: string }
): HomeNeedsAttention {
  const db = getDb();
  const rangeSql = range ? " AND date >= ? AND date <= ?" : "";
  const rangeValues = range ? [range.from, range.to] : [];
  const count = (condition: string, ...values: (string | number)[]): number =>
    (
      db
        .prepare(
          `SELECT COUNT(*) as count FROM transactions
           WHERE workspace_id = ? AND status = 'completed' AND ${condition}${rangeSql}`
        )
        .get(workspaceId, ...values, ...rangeValues) as { count: number }
    ).count;

  return {
    uncategorized: count("category_id IS NULL AND kind = 'expense'"),
    // Approving a row clears needs_review but keeps ai_confidence, so
    // approved rows must not stay in this count.
    lowConfidence: count(
      "category_source = 'ai' AND ai_confidence IS NOT NULL AND ai_confidence <= ? AND needs_review = 1",
      LOW_CONFIDENCE_MAX
    ),
    flagged: count("needs_review = 1"),
  };
}
```

- [ ] **Step 7: Add the list filters**

In `src/server/db/queries/transactions.ts`:
- Add to the imports: `import { LOW_CONFIDENCE_MAX } from "@/lib/transaction-review-filter";`
- In `interface QueryParams`, after `needsReview?: boolean;`, add:

```ts
  /** Rows with no category yet. */
  uncategorized?: boolean;
  /** AI-categorized rows at or below LOW_CONFIDENCE_MAX that still need review. */
  lowConfidence?: boolean;
```

- In `queryTransactions`, replace:

```ts
  if (params.needsReview) {
    conditions.push("t.needs_review = 1");
  }
```

with:

```ts
  if (params.needsReview) {
    conditions.push("t.needs_review = 1");
  }
  if (params.uncategorized) {
    conditions.push("t.category_id IS NULL");
  }
  if (params.lowConfidence) {
    conditions.push(
      "t.category_source = 'ai' AND t.ai_confidence IS NOT NULL AND t.ai_confidence <= ? AND t.needs_review = 1"
    );
    values.push(LOW_CONFIDENCE_MAX);
  }
```

In `src/app/api/transactions/route.ts`, after `needsReview: searchParams.get("needsReview") === "true",` add:

```ts
    uncategorized: searchParams.get("uncategorized") === "true",
    lowConfidence: searchParams.get("lowConfidence") === "true",
```

In `src/lib/api.ts`, in the `getTransactions` params type, after `needsReview?: boolean;` add:

```ts
  uncategorized?: boolean;
  lowConfidence?: boolean;
```

In `src/server/sync/categorization.ts` and `src/app/api/categorize/apply/route.ts`, add `import { LOW_CONFIDENCE_MAX } from "@/lib/transaction-review-filter";` and replace `needsReview: confidence == null || confidence <= 4,` with `needsReview: confidence == null || confidence <= LOW_CONFIDENCE_MAX,`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --conditions react-server --experimental-transform-types --test scripts/test-transaction-review-filter.mjs scripts/test-home-analytics.mjs`
Expected: PASS.

- [ ] **Step 9: Seed `/transactions` filters from the URL**

In `src/components/transactions/transactions-page.tsx`:

Replace the imports from `import { useState } from "react";` through `const TRANSACTIONS_SOURCE_TYPE = "bank" as const;` with:

```tsx
import { useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { HelpCircle, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { PageHeader } from "@/components/layout/app-shell";
import { TransactionsTable } from "@/components/dashboard/transactions-table";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { AINotConnectedBanner } from "@/components/ai-not-connected-banner";
import { KpiCards } from "./kpi-cards";
import { WidgetsRow } from "./widgets-row";
import {
  getCategories,
  getTransactions,
  getTransactionsSummary,
  listIntegrations,
} from "@/lib/api";
import type { TransactionKindFilter } from "@/lib/api";
import { expandCategoryFilterIds } from "@/lib/transaction-filters";
import {
  nextSortState,
  type SortOrder,
  type TransactionSortField,
} from "@/lib/transaction-sort";
import {
  addMonths,
  formatMonthLabel,
  getMonthRange,
} from "@/lib/formatters";
import {
  reviewFilterQuery,
  type TransactionReviewFilter,
} from "@/lib/transaction-review-filter";
import { parseTransactionsUrlState } from "@/lib/transactions-url";
import { monthKeyToDate } from "@/lib/home-month";
import type { TransactionSourceType } from "@/lib/transaction-source-types";
import type { Locale } from "@/i18n/routing";

const DEFAULT_SOURCE_TYPE: TransactionSourceType = "bank";
```

Replace the state block from `const [selectedDate, setSelectedDate] = useState(new Date());` through `useState<TransactionReviewFilter>("all");` with:

```tsx
  const searchParams = useSearchParams();
  // Deep links from Home (month, category, review queue) seed the filters once.
  const [initialFilters] = useState(() => parseTransactionsUrlState(searchParams));
  const [selectedDate, setSelectedDate] = useState(() =>
    initialFilters.month ? monthKeyToDate(initialFilters.month) : new Date()
  );
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<number[]>(
    initialFilters.categoryIds
  );
  const [accountFilter, setAccountFilter] = useState<number[]>([]);
  const [page, setPage] = useState(0);
  const [kind, setKind] = useState<TransactionKindFilter>(
    initialFilters.kind ?? "expense"
  );
  const [reviewFilter, setReviewFilter] = useState<TransactionReviewFilter>(
    initialFilters.review
  );
  const [sourceType, setSourceType] = useState<TransactionSourceType>(
    initialFilters.source ?? DEFAULT_SOURCE_TYPE
  );
```

In `transactionsQuery`:
- add `sourceType,` to the end of the `queryKey` array (after `sortOrder,`),
- replace `sourceType: TRANSACTIONS_SOURCE_TYPE,` with `sourceType,`,
- replace `needsReview: serializeReviewFilter(reviewFilter) === "true",` with `...reviewFilterQuery(reviewFilter),`.

In `summaryQuery`, replace both `TRANSACTIONS_SOURCE_TYPE` with `sourceType`.

Replace `const pendingReviewActive = isPendingReviewFilter(reviewFilter);` with:

```tsx
  const reviewChipLabel =
    reviewFilter === "uncategorized"
      ? t("reviewUncategorized")
      : reviewFilter === "lowConfidence"
        ? t("reviewLowConfidence")
        : t("pendingReview");
  const sourceChipLabel =
    sourceType === "card" ? t("sourceCards") : t("sourceAll");
```

Replace the whole `{pendingReviewActive ? ( ... ) : null}` block with:

```tsx
          {reviewFilter !== "all" ? (
            <FilterChip
              icon={
                <HelpCircle
                  className="size-3.5"
                  style={{ color: "var(--status-heads-up)" }}
                  aria-hidden="true"
                />
              }
              label={reviewChipLabel}
              onClear={() => {
                setReviewFilter("all");
                setPage(0);
              }}
            />
          ) : null}
          {sourceType !== DEFAULT_SOURCE_TYPE ? (
            <FilterChip
              label={sourceChipLabel}
              onClear={() => {
                setSourceType(DEFAULT_SOURCE_TYPE);
                setPage(0);
              }}
            />
          ) : null}
```

At the end of the file, add:

```tsx
function FilterChip({
  icon,
  label,
  onClear,
}: {
  icon?: ReactNode;
  label: string;
  onClear: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent"
    >
      {icon}
      {label}
      <X className="size-3.5 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}
```

In `en.json`, directly after `"pendingReview": "Pending review",` add:

```json
    "reviewUncategorized": "Uncategorized",
    "reviewLowConfidence": "Low AI confidence",
```

In `he.json`, directly after `"pendingReview": "ממתין לבדיקה",` add:

```json
    "reviewUncategorized": "ללא קטגוריה",
    "reviewLowConfidence": "ביטחון AI נמוך",
```

- [ ] **Step 10: Rewrite `src/components/home/needs-attention-card.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, CircleHelp, Flag, type LucideIcon } from "lucide-react";
import { CardShell } from "./card-shell";
import {
  buildNeedsAttentionRows,
  type NeedsAttentionRowId,
} from "@/lib/home-needs-attention";
import type { HomeNeedsAttention } from "@/lib/types";

const ROW_META: Record<NeedsAttentionRowId, { icon: LucideIcon; labelKey: string }> = {
  uncategorized: { icon: CircleHelp, labelKey: "needsAttentionUncategorized" },
  lowConfidence: { icon: AlertTriangle, labelKey: "needsAttentionLowConfidence" },
  flagged: { icon: Flag, labelKey: "needsAttentionFlagged" },
};

interface Props {
  data: HomeNeedsAttention;
  /** "YYYY-MM"; row links open /transactions for this month. */
  month: string;
}

export function NeedsAttentionCard({ data, month }: Props) {
  const t = useTranslations("home");
  const rows = buildNeedsAttentionRows(data, month);
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  if (total === 0) {
    return (
      <CardShell label={t("needsAttention")}>
        <div className="flex flex-1 items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--status-on-track)]" />
          {t("allClear")}
        </div>
      </CardShell>
    );
  }

  return (
    <CardShell label={t("needsAttention")}>
      <ul className="flex flex-1 flex-col gap-2">
        {rows.map((row) => {
          const meta = ROW_META[row.id];
          return (
            <Row
              key={row.id}
              icon={<meta.icon className="h-4 w-4" />}
              label={t(meta.labelKey)}
              count={row.count}
              href={row.href}
            />
          );
        })}
      </ul>
    </CardShell>
  );
}

function Row({
  icon,
  label,
  count,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  href: string;
}) {
  if (count === 0) {
    return (
      <li className="flex items-center justify-between rounded-xl px-3 py-2 text-sm text-muted-foreground">
        <span className="flex items-center gap-2.5">
          <span className="text-muted-foreground/60">{icon}</span>
          {label}
        </span>
        <span className="text-xs tabular-nums">0</span>
      </li>
    );
  }
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center justify-between rounded-xl px-3 py-2 text-sm transition-colors hover:bg-accent/50"
      >
        <span className="flex items-center gap-2.5">
          <span className="text-foreground/80">{icon}</span>
          {label}
        </span>
        <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium tabular-nums group-hover:bg-foreground/15">
          {count}
        </span>
      </Link>
    </li>
  );
}
```

In `src/components/home/home-page.tsx`, replace `<NeedsAttentionCard data={data.needsAttention} />` with `<NeedsAttentionCard data={data.needsAttention} month={data.month} />`.

In `src/app/api/home/route.ts`, replace `() => getNeedsAttentionCounts(workspaceId)` with:

```ts
    () =>
      getNeedsAttentionCounts(workspaceId, {
        from: selected.from,
        to: selected.to,
      })
```

- [ ] **Step 11: Full verification**

Run: `npm run test:logic`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

Run: `npm run build` (dev server stopped)
Expected: build succeeds.

- [ ] **Step 12: Manual check (demo data dir)**

Use the current month's key as `YYYY-MM`.
- [ ] Home, English: Needs attention shows Uncategorized 1, Low AI confidence 1, Flagged for review 2. Each row opens `/transactions?...`.
- [ ] The Low AI confidence link shows only "Demo low confidence", with chips "Low AI confidence" and "All sources". Clicking the source chip goes back to bank-only rows; clicking the review chip clears the review filter.
- [ ] The Uncategorized link lists "Demo uncategorized" (a card row, so `source=all` is required).
- [ ] Open `/transactions?month=YYYY-MM&review=bogus&kind=bogus&source=moon`: the page loads with default filters and no chips.
- [ ] `/transactions` without params is unchanged (bank only, current month, Expenses).
- [ ] Hebrew, light and dark: chips read RTL, the X sits at the inline end.
- [ ] 375 px width: chips wrap without horizontal scroll.

- [ ] **Step 13: Commit**

```bash
git add src/lib/transaction-review-filter.ts src/lib/transactions-url.ts src/lib/home-needs-attention.ts src/server/db/queries/home.ts src/server/db/queries/transactions.ts src/app/api/transactions/route.ts src/lib/api.ts src/server/sync/categorization.ts src/app/api/categorize/apply/route.ts src/components/transactions/transactions-page.tsx src/components/home/needs-attention-card.tsx src/components/home/home-page.tsx src/app/api/home/route.ts src/i18n/messages/en.json src/i18n/messages/he.json scripts/test-transaction-review-filter.mjs scripts/test-home-analytics.mjs
git diff --cached   # read it: synthetic values only
git commit -F - <<'EOF'
fix: count low-confidence rows correctly and link review rows to filters

The Needs attention card counted ai_confidence < 0.5, but confidence is
on a 1-7 scale, so the count was always 0. It now uses the same
threshold as categorization (<= 4, shared as LOW_CONFIDENCE_MAX) and
requires needs_review = 1, so rows the user approved drop out. Counts
are scoped to the selected home month.

Every row used to open plain /transactions. Rows now link to the
matching filter for that month:
- /transactions reads month, category, kind, review and source from the
  URL to seed its filters, and shows removable chips for the review
  filter and a non-default source.
- The transactions query gains uncategorized and lowConfidence filters.
- Home links pass source=all because card purchases live outside the
  page's default bank-only view.

The card builds its rows from buildNeedsAttentionRows, so the trips
queue can add a row without touching the layout.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Month picker, KPI tiles and the new grid

**Files:**
- Modify: `src/components/dashboard/period-selector.tsx` (full rewrite below)
- Create: `src/components/home/home-month-picker.tsx`
- Create: `src/components/home/kpi-tiles.tsx`
- Modify: `src/components/home/home-page.tsx` (full rewrite below)
- Delete: `src/components/home/cash-flow-card.tsx`
- Modify: `src/app/api/home/route.ts`, `src/lib/types.ts` (drop `cashFlow`)
- Modify: `src/i18n/messages/en.json`, `he.json`

**Interfaces:**
- Consumes: `resolveHomeMonthKey`, `homeHrefForMonth`, `monthKeyFromDate`, `shiftMonthKey` (Task 1); `computeKpiDelta`, `HomeKpiKey`, `HomeKpiDelta` (Task 1); formatters (Task 1); `getHome(month)` (Task 2); `HomeKpis` payload (Task 2); `NeedsAttentionCard` with `month` (Task 4).
- Produces:
  - `PeriodSelector` gains optional `prevDisabled?: boolean; nextDisabled?: boolean; prevLabel?: string; nextLabel?: string`.
  - `HomeMonthPicker({ month: string; currentMonth: string; onChange: (month: string) => void })`
  - `KpiTiles({ data: HomeKpis })`, `KpiTilesSkeleton()`
  - `home-page.tsx`: final grid slots, `SectionContext`, `renderSection(section, ctx, spanClass)`, `renderCard(section, data)`. Tasks 6 to 8 edit `renderCard` and the imports.
  - `HomeSection` and `HomePayload` lose `cashFlow`.

- [ ] **Step 1: Extend `PeriodSelector`**

Replace `src/components/dashboard/period-selector.tsx` with:

```tsx
"use client";

import { Button } from "@/components/ui/button";

interface PeriodSelectorProps {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  prevLabel?: string;
  nextLabel?: string;
}

export function PeriodSelector({
  label,
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
  prevLabel,
  nextLabel,
}: PeriodSelectorProps) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-input bg-background px-1">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onPrev}
        disabled={prevDisabled}
        aria-label={prevLabel}
      >
        <svg
          className="h-3.5 w-3.5 rtl:rotate-180"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 19l-7-7 7-7"
          />
        </svg>
      </Button>
      <span className="min-w-[120px] text-center text-sm font-medium tabular-nums">
        {label}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onNext}
        disabled={nextDisabled}
        aria-label={nextLabel}
      >
        <svg
          className="h-3.5 w-3.5 rtl:rotate-180"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 5l7 7-7 7"
          />
        </svg>
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/home/home-month-picker.tsx`**

```tsx
"use client";

import { useLocale, useTranslations } from "next-intl";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { formatMonthKey } from "@/lib/formatters";
import { shiftMonthKey } from "@/lib/home-month";
import type { Locale } from "@/i18n/routing";

interface Props {
  month: string;
  currentMonth: string;
  onChange: (month: string) => void;
}

export function HomeMonthPicker({ month, currentMonth, onChange }: Props) {
  const t = useTranslations("home");
  const locale = useLocale() as Locale;
  return (
    <PeriodSelector
      label={formatMonthKey(month, locale, "short")}
      onPrev={() => onChange(shiftMonthKey(month, -1))}
      onNext={() => onChange(shiftMonthKey(month, 1))}
      nextDisabled={month >= currentMonth}
      prevLabel={t("monthPickerPrev")}
      nextLabel={t("monthPickerNext")}
    />
  );
}
```

- [ ] **Step 3: Create `src/components/home/kpi-tiles.tsx`**

```tsx
"use client";

import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ArrowUp } from "lucide-react";
import { CardShell } from "./card-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  formatSignedCurrency,
  formatSignedNumber,
  formatSignedPercent,
  formatWholeCurrency,
} from "@/lib/formatters";
import {
  computeKpiDelta,
  type HomeKpiDelta,
  type HomeKpiKey,
} from "@/lib/home-kpis";
import type { Locale } from "@/i18n/routing";
import type { HomeKpiFigures, HomeKpis } from "@/lib/types";

const KPI_ORDER: HomeKpiKey[] = ["income", "expenses", "net", "savingsRate"];

const KPI_LABEL_KEYS: Record<HomeKpiKey, string> = {
  income: "kpiIncome",
  expenses: "kpiExpenses",
  net: "kpiNet",
  savingsRate: "kpiSavingsRate",
};

const TILE_GRID = "grid grid-cols-2 gap-4 md:gap-5 lg:grid-cols-4 lg:gap-6";

export function KpiTiles({ data }: { data: HomeKpis }) {
  return (
    <div className={TILE_GRID}>
      {KPI_ORDER.map((kpi) => (
        <KpiTile key={kpi} kpi={kpi} data={data} />
      ))}
    </div>
  );
}

export function KpiTilesSkeleton() {
  return (
    <div className={TILE_GRID}>
      {KPI_ORDER.map((kpi) => (
        <CardShell key={kpi} className="p-4 md:p-5">
          <Skeleton className="h-28 w-full" />
        </CardShell>
      ))}
    </div>
  );
}

function KpiTile({ kpi, data }: { kpi: HomeKpiKey; data: HomeKpis }) {
  const t = useTranslations("home");
  const locale = useLocale() as Locale;
  const notAvailable = t("kpiNotAvailable");
  const delta = computeKpiDelta(kpi, data, data.prev);
  const valueTone =
    kpi === "net" && Math.round(data.net) !== 0
      ? data.net > 0
        ? "text-[var(--status-on-track)]"
        : "text-[var(--status-over)]"
      : "text-foreground";

  return (
    <CardShell label={t(KPI_LABEL_KEYS[kpi])} className="p-4 md:p-5">
      <div className="flex flex-1 flex-col gap-2">
        <div
          className={cn(
            "font-serif text-2xl leading-none tracking-tight tabular-nums sm:text-3xl xl:text-4xl",
            valueTone
          )}
        >
          <span dir="ltr">{formatKpiValue(kpi, data, locale, notAvailable)}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {data.isCurrentMonth
            ? t("kpiSoFar", { day: data.dayOfMonth, days: data.daysInMonth })
            : t("kpiFullMonth")}
        </div>
        <DeltaLine delta={delta} isCurrentMonth={data.isCurrentMonth} locale={locale} />
        <div className="mt-auto border-t border-border/60 pt-2 text-xs text-muted-foreground">
          {data.avg6
            ? t("kpiAverage", {
                months: data.avg6.months,
                value: formatKpiValue(kpi, data.avg6, locale, notAvailable),
              })
            : t("kpiNoAverage")}
        </div>
      </div>
    </CardShell>
  );
}

function DeltaLine({
  delta,
  isCurrentMonth,
  locale,
}: {
  delta: HomeKpiDelta | null;
  isCurrentMonth: boolean;
  locale: Locale;
}) {
  const t = useTranslations("home");
  if (!delta) {
    return <div className="text-xs text-muted-foreground">{t("kpiNoComparison")}</div>;
  }
  const rounded = Math.round(delta.value);
  const Icon = rounded > 0 ? ArrowUp : ArrowDown;
  const tone =
    delta.favorable == null
      ? "bg-muted/60 text-muted-foreground"
      : delta.favorable
        ? "bg-[var(--status-on-track)]/10 text-[var(--status-on-track)]"
        : "bg-[var(--status-over)]/10 text-[var(--status-over)]";
  const text =
    delta.unit === "percent"
      ? formatSignedPercent(delta.value)
      : delta.unit === "currency"
        ? formatSignedCurrency(delta.value, locale)
        : t("kpiPoints", { value: formatSignedNumber(delta.value) });

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium tabular-nums",
          tone
        )}
        title={t(isCurrentMonth ? "comparedToLastMonth" : "comparedToPreviousMonth")}
      >
        {rounded !== 0 && <Icon className="h-3 w-3" aria-hidden />}
        <span dir="ltr">{text}</span>
      </span>
      <span className="text-muted-foreground">
        {t(isCurrentMonth ? "kpiVsSameDays" : "kpiVsLastMonth")}
      </span>
    </div>
  );
}

function formatKpiValue(
  kpi: HomeKpiKey,
  figures: HomeKpiFigures,
  locale: Locale,
  notAvailable: string
): string {
  switch (kpi) {
    case "income":
      return formatWholeCurrency(figures.income, locale);
    case "expenses":
      return formatWholeCurrency(figures.expenses, locale);
    case "net":
      return formatSignedCurrency(figures.net, locale);
    case "savingsRate":
      if (figures.savingsRate == null) return notAvailable;
      return figures.savingsRate < 0
        ? formatSignedPercent(figures.savingsRate * 100)
        : `${Math.round(figures.savingsRate * 100)}%`;
  }
}
```

- [ ] **Step 4: Rewrite `src/components/home/home-page.tsx`**

The grid is final from here on. Slots whose new card has not landed yet render the legacy card (removed in Tasks 6 to 8).

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { getActivity, getHome } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  homeHrefForMonth,
  monthKeyFromDate,
  resolveHomeMonthKey,
} from "@/lib/home-month";
import { PageHeader } from "@/components/layout/app-shell";
import { SyncButton } from "@/components/dashboard/sync-button";
import { ImportXlsxButton } from "@/components/dashboard/import-xlsx-button";
import { CategorizeButton } from "@/components/dashboard/categorize-button";
import { AINotConnectedBanner } from "@/components/ai-not-connected-banner";
import { HomeMonthPicker } from "./home-month-picker";
import { KpiTiles, KpiTilesSkeleton } from "./kpi-tiles";
import { ThisMonthCard } from "./this-month-card";
import { CategorySnapshotCard } from "./category-snapshot-card";
import { HistoricalTrendCard } from "./historical-trend-card";
import { RecentTransactionsCard } from "./recent-transactions-card";
import { SpendingStatsCard } from "./spending-stats-card";
import { NeedsAttentionCard } from "./needs-attention-card";
import { BankHealthCard } from "./bank-health-card";
import { SyncStatusPill } from "./sync-status-pill";
import { SyncFailureBanner } from "./sync-failure-banner";
import { CardError, CardSkeleton } from "./card-shell";
import type { DataSourceMode, HomePayload, HomeSection } from "@/lib/types";

const ROW_FULL = "col-span-12";
const ROW_MAIN = "col-span-12 md:col-span-6 lg:col-span-7";
const ROW_SIDE = "col-span-12 md:col-span-6 lg:col-span-5";

interface SectionContext {
  data: HomePayload | undefined;
  isLoading: boolean;
  isError: boolean;
  skeletonLabels: Record<HomeSection, string>;
}

export function HomePage({ dataSourceMode }: { dataSourceMode: DataSourceMode }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const scraperMode = dataSourceMode === "scraper";
  const [now] = useState(() => new Date());
  const currentMonth = monthKeyFromDate(now);
  const monthParam = searchParams.get("month");
  const selectedMonth = resolveHomeMonthKey(monthParam, now);
  const [autoStartSync] = useState(
    () => scraperMode && searchParams.get("sync") === "1"
  );
  const t = useTranslations("home");
  const skeletonLabels = useMemo<Record<HomeSection, string>>(
    () => ({
      kpis: t("kpisTitle"),
      historicalTrend: t("trendTitle"),
      categoryBreakdown: t("whereMoneyWent"),
      budgetPace: t("budgetPaceTitle"),
      thisMonth: t("budgetPaceTitle"),
      categorySnapshot: t("whereMoneyWent"),
      recentTransactions: t("recentActivity"),
      spendingStats: t("spendingStatsTitle"),
      needsAttention: t("needsAttention"),
      bankHealth: t("bankConnections"),
    }),
    [t]
  );

  useEffect(() => {
    if (autoStartSync) {
      router.replace("/", { scroll: false });
    }
  }, [autoStartSync, router]);

  // A typed, stale or future ?month falls back to the current month instead
  // of a 400 from the API.
  useEffect(() => {
    if (monthParam != null && monthParam !== selectedMonth) {
      router.replace(homeHrefForMonth(selectedMonth, now), { scroll: false });
    }
  }, [monthParam, selectedMonth, router, now]);

  const { data, isLoading, isError, isFetching, isPlaceholderData } = useQuery({
    queryKey: ["home", selectedMonth],
    queryFn: () => getHome(selectedMonth),
    placeholderData: keepPreviousData,
  });

  const handleMonthChange = useCallback(
    (month: string) => {
      router.push(homeHrefForMonth(month, now), { scroll: false });
    },
    [router, now]
  );

  const [activityPopoverOpen, setActivityPopoverOpen] = useState(false);
  const { data: activity } = useQuery({
    queryKey: ["activity"],
    queryFn: getActivity,
    refetchInterval: (q) => {
      const a = q.state.data;
      if (activityPopoverOpen) return 3000;
      if (a?.sync.active) return 3000;
      return 15000;
    },
    refetchIntervalInBackground: false,
  });

  const handleActivityOpenChange = useCallback(
    (open: boolean) => {
      setActivityPopoverOpen(open);
      if (open) queryClient.invalidateQueries({ queryKey: ["activity"] });
    },
    [queryClient]
  );

  const handleSyncOrCategorizeComplete = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["home"] });
    queryClient.invalidateQueries({ queryKey: ["summary"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["settings"] });
    queryClient.invalidateQueries({ queryKey: ["activity"] });
  }, [queryClient]);

  // While another month loads, keep the previous one visible but dimmed.
  const refreshing = isFetching && isPlaceholderData;
  const ctx: SectionContext = { data, isLoading, isError, skeletonLabels };
  const monthPicker = (
    <HomeMonthPicker
      month={selectedMonth}
      currentMonth={currentMonth}
      onChange={handleMonthChange}
    />
  );

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        actions={
          <>
            <div className="hidden md:block">{monthPicker}</div>
            {scraperMode && (
              <SyncStatusPill
                items={data?.bankHealth ?? null}
                nextScheduledSync={data?.nextScheduledSync ?? null}
                activity={activity ?? null}
                onOpenChange={handleActivityOpenChange}
              />
            )}
            <CategorizeButton onApplied={handleSyncOrCategorizeComplete} />
            {scraperMode ? (
              <SyncButton
                onComplete={handleSyncOrCategorizeComplete}
                autoStart={autoStartSync}
              />
            ) : (
              <ImportXlsxButton onComplete={handleSyncOrCategorizeComplete} />
            )}
          </>
        }
      />

      <div className="p-4 md:p-6 lg:p-8">
        <div className="mb-4 flex justify-center md:hidden">{monthPicker}</div>
        {scraperMode && (
          <SyncFailureBanner
            items={data?.bankHealth ?? null}
            className="mb-4 md:mb-5 lg:mb-6"
          />
        )}
        <AINotConnectedBanner className="mb-4 md:mb-5 lg:mb-6" />
        <div
          className={cn(
            "grid grid-cols-12 gap-4 transition-opacity md:gap-5 lg:gap-6",
            refreshing && "opacity-60"
          )}
          aria-busy={refreshing}
        >
          {renderSection("kpis", ctx, ROW_FULL)}
          {renderSection("historicalTrend", ctx, ROW_FULL)}
          {renderSection("categoryBreakdown", ctx, ROW_MAIN)}
          {renderSection("budgetPace", ctx, ROW_SIDE)}
          {renderSection("spendingStats", ctx, ROW_MAIN)}
          {renderSection("needsAttention", ctx, ROW_SIDE)}
          {renderSection("recentTransactions", ctx, scraperMode ? ROW_MAIN : ROW_FULL)}
          {scraperMode && renderSection("bankHealth", ctx, ROW_SIDE)}
        </div>
      </div>
    </>
  );
}

function renderSection(section: HomeSection, ctx: SectionContext, spanClass: string) {
  const { data, isLoading, isError, skeletonLabels } = ctx;
  if (isLoading || !data) {
    return (
      <div key={section} className={spanClass}>
        {section === "kpis" ? (
          <KpiTilesSkeleton />
        ) : (
          <CardSkeleton
            label={skeletonLabels[section]}
            height={SKELETON_HEIGHTS[section]}
          />
        )}
      </div>
    );
  }

  const sectionHasError =
    isError || data.errors.some((e) => e.section === section);

  if (sectionHasError) {
    return (
      <div key={section} className={spanClass}>
        <CardError label={skeletonLabels[section]} />
      </div>
    );
  }

  return (
    <div key={section} className={spanClass}>
      {renderCard(section, data)}
    </div>
  );
}

function renderCard(section: HomeSection, data: HomePayload) {
  switch (section) {
    case "kpis":
      return data.kpis ? <KpiTiles data={data.kpis} /> : null;
    case "historicalTrend":
      return data.historicalTrend ? (
        <HistoricalTrendCard data={data.historicalTrend} />
      ) : null;
    case "categoryBreakdown":
      // Legacy card in this slot until the where-money-went card lands.
      return data.categorySnapshot ? (
        <CategorySnapshotCard items={data.categorySnapshot} />
      ) : null;
    case "budgetPace":
      // Legacy card in this slot until the budget pace card lands.
      return data.thisMonth ? <ThisMonthCard data={data.thisMonth} /> : null;
    case "thisMonth":
    case "categorySnapshot":
      // Legacy payload fields that are no longer placed in the grid.
      return null;
    case "recentTransactions":
      return data.recentTransactions ? (
        <RecentTransactionsCard items={data.recentTransactions} />
      ) : null;
    case "spendingStats":
      return data.spendingStats ? (
        <SpendingStatsCard data={data.spendingStats} />
      ) : null;
    case "needsAttention":
      return data.needsAttention ? (
        <NeedsAttentionCard data={data.needsAttention} month={data.month} />
      ) : null;
    case "bankHealth":
      return data.bankHealth ? (
        <BankHealthCard items={data.bankHealth} />
      ) : null;
  }
}

const SKELETON_HEIGHTS: Record<HomeSection, number> = {
  kpis: 120,
  historicalTrend: 300,
  categoryBreakdown: 260,
  budgetPace: 180,
  thisMonth: 180,
  categorySnapshot: 220,
  recentTransactions: 280,
  spendingStats: 420,
  needsAttention: 160,
  bankHealth: 160,
};
```

- [ ] **Step 5: Drop the `cashFlow` section**

- Delete the card: `git rm src/components/home/cash-flow-card.tsx`
- In `src/lib/types.ts`, remove `| "cashFlow"` from `HomeSection` and `cashFlow: HomeCashFlow | null;` from `HomePayload`. Keep the `HomeCashFlow` interface (`getCashFlow` returns it).
- In `src/app/api/home/route.ts`, remove `getCashFlow,` from the home query imports, `HomeCashFlow,` from the type imports, the whole `const cashFlow = safe<HomeCashFlow>(...)` block, and `cashFlow,` from `payload`.

- [ ] **Step 6: Add the i18n strings**

In `en.json`, directly after `"pageTitle": "Home",` add:

```json
    "kpisTitle": "Income and expenses",
    "monthPickerPrev": "Previous month",
    "monthPickerNext": "Next month",
    "kpiIncome": "Income",
    "kpiExpenses": "Expenses",
    "kpiNet": "Net",
    "kpiSavingsRate": "Savings rate",
    "kpiSoFar": "So far (day {day} of {days})",
    "kpiFullMonth": "Full month",
    "kpiVsLastMonth": "vs. last month",
    "kpiVsSameDays": "vs. same days last month",
    "kpiNoComparison": "No data last month",
    "kpiAverage": "{months, plural, one {Avg of # month} other {Avg of # months}}: {value}",
    "kpiNoAverage": "No earlier months to average yet",
    "kpiNotAvailable": "n/a",
    "kpiPoints": "{value} pts",
    "comparedToPreviousMonth": "Compared to the full previous month",
```

In `he.json`, directly after `"pageTitle": "בית",` add:

```json
    "kpisTitle": "הכנסות והוצאות",
    "monthPickerPrev": "החודש הקודם",
    "monthPickerNext": "החודש הבא",
    "kpiIncome": "הכנסות",
    "kpiExpenses": "הוצאות",
    "kpiNet": "נטו",
    "kpiSavingsRate": "שיעור חיסכון",
    "kpiSoFar": "עד כה (יום {day} מתוך {days})",
    "kpiFullMonth": "חודש מלא",
    "kpiVsLastMonth": "לעומת החודש הקודם",
    "kpiVsSameDays": "לעומת אותם ימים בחודש הקודם",
    "kpiNoComparison": "אין נתונים מהחודש הקודם",
    "kpiAverage": "{months, plural, one {ממוצע של חודש אחד} other {ממוצע של # חודשים}}: {value}",
    "kpiNoAverage": "אין עדיין חודשים קודמים לממוצע",
    "kpiNotAvailable": "לא זמין",
    "kpiPoints": "{value} נק׳",
    "comparedToPreviousMonth": "השוואה לחודש הקודם המלא",
```

- [ ] **Step 7: Automated verification**

Run: `npm run test:logic`
Expected: PASS (includes the en/he key parity guard).

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

Run: `npm run build` (dev server stopped)
Expected: build succeeds.

- [ ] **Step 8: Manual check (demo data dir)**

- [ ] English, light: header shows `‹ Oct 2026 ›` (your current month) next to Categorize and Import; `›` is disabled.
- [ ] Four tiles: Income, Expenses, Net (green when positive, red with a minus when negative), Savings rate. Each shows "So far (day N of M)", a delta pill with "vs. same days last month", and "Avg of 6 months: ₪...".
- [ ] Click `‹`: URL becomes `/?month=YYYY-MM`, the grid dims briefly then updates, tiles say "Full month" and "vs. last month", and `›` is enabled. Browser Back returns to the previous month.
- [ ] Go back to the earliest seeded month: the average line reads "No earlier months to average yet" and the delta reads "No data last month".
- [ ] Open `/?month=2026-13` and `/?month=2099-01`: the page shows the current month and the URL is cleaned to `/`.
- [ ] Dark theme: tiles, pills and the disabled arrow stay legible.
- [ ] Hebrew: the picker shows the Hebrew month, `‹` points the RTL way, tile values keep their sign in front (`−₪1,234`), labels read right to left.
- [ ] 375 px: the picker sits above the tiles, tiles are 2x2, no value is clipped, no horizontal scroll.

- [ ] **Step 9: Commit**

```bash
git add src/components/dashboard/period-selector.tsx src/components/home/home-month-picker.tsx src/components/home/kpi-tiles.tsx src/components/home/home-page.tsx src/app/api/home/route.ts src/lib/types.ts src/i18n/messages/en.json src/i18n/messages/he.json
git diff --cached   # read it: synthetic values only
git commit -F - <<'EOF'
feat: add the home month picker, KPI tiles and the new grid

Home is now month-scoped. The selected month lives in ?month=YYYY-MM
(the current month is the bare / URL), with a picker in the header that
reuses the PeriodSelector pattern; next is disabled at the current
month. A bad or future ?month falls back to the current month. While
another month loads, the previous one stays on screen, dimmed.

The four KPI tiles (income, expenses, net, savings rate) replace the
Cash flow card. Each shows the value in the hero serif, a delta vs the
same days of last month (or the full previous month for past months)
and the average of the completed months before it.

The grid now follows the spec layout on lg, two columns on md and one
on mobile. Slots whose new cards are still to come render the legacy
cards for now.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: 12-month cash-flow chart

**Files:**
- Modify: `src/app/globals.css:76-81` (`:root` tokens) and the `.dark` block (`--chart-5` line)
- Create: `src/components/home/cash-flow-chart-card.tsx`
- Delete: `src/components/home/historical-trend-card.tsx`
- Modify: `src/components/home/home-page.tsx`
- Modify: `src/i18n/messages/en.json`, `he.json`

**Interfaces:**
- Consumes: `HomeHistoricalTrendPoint` with `isSelected` (Task 2); `formatMonthKey`, `formatCompactCurrency`, `formatWholeCurrency`, `formatSignedCurrency` (Task 1); `handleMonthChange` in `home-page.tsx` (Task 5).
- Produces: `CashFlowChartCard({ data: HomeHistoricalTrendPoint[]; onSelectMonth: (month: string) => void })`; `home-page.tsx` gains `SectionHandlers { onSelectMonth }` and `renderCard(section, data, handlers)`.

Dataviz rules applied here: income and expense bars get their own validated tokens (status colors stay reserved for good and bad states); one y-axis in ₪ (the net line shares it, same unit); hairline horizontal grid; 4 px rounded bar tops, bars capped at 24 px; a 2 px net line with 8 px dots ringed in the card color; a legend because there are three series; one tooltip listing all three values with line keys; a table view so nothing is hover-only; dark values are their own validated steps, not a flip.

- [ ] **Step 1: Add the chart tokens**

In `src/app/globals.css`, in `:root`, replace:

```css
  --chart-5: oklch(0.74 0.10 230); /* sky - transport */
```

with:

```css
  --chart-5: oklch(0.74 0.10 230); /* sky - transport */
  /* Home cash-flow series. Validated with the dataviz palette checks on the
     white card: lightness band, CVD separation, 3:1 contrast. */
  --chart-income: oklch(0.58 0.11 230);
  --chart-expense: oklch(0.62 0.14 40);
```

In `.dark`, replace:

```css
  --chart-5: oklch(0.74 0.10 240);
```

with:

```css
  --chart-5: oklch(0.74 0.10 240);
  --chart-income: oklch(0.64 0.11 235);
  --chart-expense: oklch(0.65 0.15 38);
```

These were checked with the dataviz skill's `validate_palette.js` while writing this plan: light `#1785af,#cb6440` on `#ffffff` passes all checks (CVD worst ΔE 16.0, contrast at least 3:1); dark `#3c96c5,#da6946` on `#1e1a16` passes all checks (CVD worst ΔE 18.1). The existing `--chart-5`/`--chart-2` pair failed (contrast WARN in light, lightness band FAIL in dark), which is why new tokens are added. Optional re-check: the validator ships with the dataviz skill as `scripts/validate_palette.js`. From that skill's directory, run `node scripts/validate_palette.js "#1785af,#cb6440" --mode light --surface "#ffffff"` and `node scripts/validate_palette.js "#3c96c5,#da6946" --mode dark --surface "#1e1a16"`. Expected: `ALL CHECKS PASS` for both. If you change a token value, convert it to hex first (the conversion is the same as `scripts/oklch-to-hex.mjs` in this repo) and re-run both checks.

- [ ] **Step 2: Create `src/components/home/cash-flow-chart-card.tsx`**

```tsx
"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type MouseHandlerDataParam,
  type XAxisTickContentProps,
} from "recharts";
import { CardShell } from "./card-shell";
import { cn } from "@/lib/utils";
import {
  formatCompactCurrency,
  formatMonthKey,
  formatSignedCurrency,
  formatWholeCurrency,
} from "@/lib/formatters";
import type { Locale } from "@/i18n/routing";
import type { HomeHistoricalTrendPoint } from "@/lib/types";

const INCOME_COLOR = "var(--chart-income)";
const EXPENSE_COLOR = "var(--chart-expense)";
const NET_COLOR = "var(--foreground)";
const DIMMED_OPACITY = 0.45;

interface Props {
  data: HomeHistoricalTrendPoint[];
  onSelectMonth: (month: string) => void;
}

export function CashFlowChartCard({ data, onSelectMonth }: Props) {
  const t = useTranslations("home");
  const locale = useLocale() as Locale;
  const isRtl = locale === "he";
  const hasData = data.some((point) => point.income > 0 || point.expenses > 0);
  const selectedMonth =
    data.find((point) => point.isSelected)?.month ??
    data[data.length - 1]?.month ??
    "";

  if (!hasData) {
    return (
      <CardShell label={t("trendTitle")}>
        <div className="flex flex-1 items-center justify-center py-10 text-sm text-muted-foreground">
          {t("notEnoughHistory")}
        </div>
      </CardShell>
    );
  }

  return (
    <CardShell label={t("trendTitle")} action={<ChartLegend />}>
      <figure className="m-0">
        <figcaption className="sr-only">{t("trendChartLabel")}</figcaption>
        <div className="h-60 w-full cursor-pointer md:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 8, right: 4, bottom: 0, left: 4 }}
              barGap={2}
              barCategoryGap="24%"
              onClick={(state: MouseHandlerDataParam) => {
                if (typeof state.activeLabel === "string") {
                  onSelectMonth(state.activeLabel);
                }
              }}
            >
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="month"
                reversed={isRtl}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={4}
                tick={(props: XAxisTickContentProps) => (
                  <MonthTick {...props} selectedMonth={selectedMonth} locale={locale} />
                )}
              />
              <YAxis
                orientation={isRtl ? "right" : "left"}
                axisLine={false}
                tickLine={false}
                width={56}
                tickCount={5}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                tickFormatter={(value: number) => formatCompactCurrency(value, locale)}
              />
              <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.4} />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const point = payload[0].payload as HomeHistoricalTrendPoint;
                  return <TrendTooltip point={point} locale={locale} />;
                }}
              />
              <Bar
                dataKey="income"
                name={t("cashFlowIn")}
                fill={INCOME_COLOR}
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
                isAnimationActive={false}
              >
                {data.map((point) => (
                  <Cell
                    key={point.month}
                    fillOpacity={point.isSelected ? 1 : DIMMED_OPACITY}
                  />
                ))}
              </Bar>
              <Bar
                dataKey="expenses"
                name={t("cashFlowOut")}
                fill={EXPENSE_COLOR}
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
                isAnimationActive={false}
              >
                {data.map((point) => (
                  <Cell
                    key={point.month}
                    fillOpacity={point.isSelected ? 1 : DIMMED_OPACITY}
                  />
                ))}
              </Bar>
              <Line
                type="linear"
                dataKey="net"
                name={t("cashFlowNet")}
                stroke={NET_COLOR}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={{ r: 4, fill: NET_COLOR, stroke: "var(--card)", strokeWidth: 2 }}
                activeDot={{ r: 5, fill: NET_COLOR, stroke: "var(--card)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </figure>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          {t("trendShowTable")}
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 text-start font-medium">{t("trendMonth")}</th>
                <th className="py-1 text-end font-medium">{t("cashFlowIn")}</th>
                <th className="py-1 text-end font-medium">{t("cashFlowOut")}</th>
                <th className="py-1 text-end font-medium">{t("cashFlowNet")}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr
                  key={point.month}
                  className={cn("border-t border-border/60", point.isSelected && "font-semibold")}
                >
                  <td className="py-1.5">
                    <button
                      type="button"
                      onClick={() => onSelectMonth(point.month)}
                      className="underline-offset-4 hover:underline"
                      aria-current={point.isSelected ? "date" : undefined}
                      aria-label={t("trendSelectMonth", {
                        month: formatMonthKey(point.month, locale, "long"),
                      })}
                    >
                      {formatMonthKey(point.month, locale, "short")}
                    </button>
                  </td>
                  <td className="py-1.5 text-end">
                    <span dir="ltr">{formatWholeCurrency(point.income, locale)}</span>
                  </td>
                  <td className="py-1.5 text-end">
                    <span dir="ltr">{formatWholeCurrency(point.expenses, locale)}</span>
                  </td>
                  <td className="py-1.5 text-end">
                    <span dir="ltr">{formatSignedCurrency(point.net, locale)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </CardShell>
  );
}

function MonthTick({
  x,
  y,
  payload,
  selectedMonth,
  locale,
}: XAxisTickContentProps & { selectedMonth: string; locale: Locale }) {
  const month = String(payload.value);
  const isSelected = month === selectedMonth;
  return (
    <text
      x={x}
      y={y}
      dy={12}
      textAnchor="middle"
      fontSize={11}
      fontWeight={isSelected ? 600 : 400}
      fill={isSelected ? "var(--foreground)" : "var(--muted-foreground)"}
    >
      {formatMonthKey(month, locale, "short", false)}
    </text>
  );
}

function ChartLegend() {
  const t = useTranslations("home");
  return (
    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
      <LegendItem label={t("cashFlowIn")}>
        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: INCOME_COLOR }} />
      </LegendItem>
      <LegendItem label={t("cashFlowOut")}>
        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: EXPENSE_COLOR }} />
      </LegendItem>
      <LegendItem label={t("cashFlowNet")}>
        <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: NET_COLOR }} />
      </LegendItem>
    </div>
  );
}

function LegendItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="inline-flex items-center">
        {children}
      </span>
      {label}
    </span>
  );
}

function TrendTooltip({
  point,
  locale,
}: {
  point: HomeHistoricalTrendPoint;
  locale: Locale;
}) {
  const t = useTranslations("home");
  return (
    <div className="min-w-40 rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1.5 font-medium text-popover-foreground">
        {formatMonthKey(point.month, locale, "long")}
        {point.isCurrent ? ` ${t("soFar")}` : ""}
      </div>
      <TooltipRow color={INCOME_COLOR} label={t("cashFlowIn")} value={formatWholeCurrency(point.income, locale)} />
      <TooltipRow color={EXPENSE_COLOR} label={t("cashFlowOut")} value={formatWholeCurrency(point.expenses, locale)} />
      <TooltipRow color={NET_COLOR} label={t("cashFlowNet")} value={formatSignedCurrency(point.net, locale)} />
    </div>
  );
}

function TooltipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: color }} aria-hidden />
        {label}
      </span>
      <span dir="ltr" className="font-medium tabular-nums text-popover-foreground">
        {value}
      </span>
    </div>
  );
}
```

- [ ] **Step 3: Wire the chart into `home-page.tsx`**

- Replace `import { HistoricalTrendCard } from "./historical-trend-card";` with `import { CashFlowChartCard } from "./cash-flow-chart-card";`
- Replace the `SectionContext` interface with:

```tsx
interface SectionHandlers {
  onSelectMonth: (month: string) => void;
}

interface SectionContext {
  data: HomePayload | undefined;
  isLoading: boolean;
  isError: boolean;
  skeletonLabels: Record<HomeSection, string>;
  handlers: SectionHandlers;
}
```

- Replace `const ctx: SectionContext = { data, isLoading, isError, skeletonLabels };` with:

```tsx
  const ctx: SectionContext = {
    data,
    isLoading,
    isError,
    skeletonLabels,
    handlers: { onSelectMonth: handleMonthChange },
  };
```

- In `renderSection`, replace `{renderCard(section, data)}` with `{renderCard(section, data, ctx.handlers)}`.
- Replace `function renderCard(section: HomeSection, data: HomePayload) {` with `function renderCard(section: HomeSection, data: HomePayload, handlers: SectionHandlers) {`.
- Replace the `historicalTrend` case with:

```tsx
    case "historicalTrend":
      return data.historicalTrend ? (
        <CashFlowChartCard
          data={data.historicalTrend}
          onSelectMonth={handlers.onSelectMonth}
        />
      ) : null;
```

- Delete the old card: `git rm src/components/home/historical-trend-card.tsx`

- [ ] **Step 4: Add the i18n strings**

In `en.json`, directly after `"pageTitle": "Home",` add:

```json
    "trendShowTable": "Show as table",
    "trendMonth": "Month",
    "trendChartLabel": "Income, expenses and net per month. Select a month to open it.",
    "trendSelectMonth": "Open {month}",
```

In `he.json`, directly after `"pageTitle": "בית",` add:

```json
    "trendShowTable": "הצגה כטבלה",
    "trendMonth": "חודש",
    "trendChartLabel": "הכנסות, הוצאות ונטו לפי חודש. בחרו חודש כדי לפתוח אותו.",
    "trendSelectMonth": "פתיחת {month}",
```

- [ ] **Step 5: Automated verification**

Run: `npm run test:logic`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

Run: `npm run build` (dev server stopped)
Expected: build succeeds.

- [ ] **Step 6: Manual check (demo data dir)**

- [ ] English, light: full-width chart with 12 months ending at the selected month, grouped blue (in) and orange (out) bars, a dark net line with ringed dots, ₪ ticks on the y-axis (for example `₪10K`), light gridlines, the legend in the card header.
- [ ] The selected month's bars are full strength and its tick label is bold; other months are dimmed.
- [ ] Hover a month: one tooltip with the long month name and In, Out, Net (signed). The current month adds "(so far)".
- [ ] Click a past month's bars: URL becomes `/?month=YYYY-MM`, tiles and chart update, the chart now ends at that month.
- [ ] "Show as table" lists all 12 months; Tab into a month button and press Enter: it selects that month.
- [ ] Keyboard: Tab to the chart, arrow keys move the tooltip (Recharts accessibility layer).
- [ ] Dark theme: bars and line keep contrast against the dark card; tooltip uses the popover surface.
- [ ] Hebrew: time runs right to left (oldest month at the right edge, selected month at the left edge), the y-axis sits on the right, tooltip values keep `−₪` order.
- [ ] 375 px: ticks thin out without overlapping, the table scrolls inside the card only.

- [ ] **Step 7: Commit**

```bash
git add src/app/globals.css src/components/home/cash-flow-chart-card.tsx src/components/home/home-page.tsx src/i18n/messages/en.json src/i18n/messages/he.json
git diff --cached   # read it: synthetic values only
git commit -F - <<'EOF'
feat: replace the home trend card with a 12-month cash-flow chart

The old trend card was a 96px hand-drawn SVG with no axis. The new card
uses Recharts: grouped income and expense bars plus a net line on one
shekel axis, ending at the selected month.

- The selected month is highlighted; clicking a month sets ?month.
- One tooltip lists In, Out and Net; a legend names the three series and
  a "Show as table" view keeps every value reachable without hover,
  with month buttons for keyboard users.
- Income and expense colors are new --chart-income and --chart-expense
  tokens with separate light and dark values that pass the dataviz
  palette checks. Status colors stay reserved for good and bad states.
- In Hebrew the time axis runs right to left and the y-axis moves to the
  right.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Where money went card

**Files:**
- Create: `src/components/home/where-money-went-card.tsx`
- Delete: `src/components/home/category-snapshot-card.tsx`
- Modify: `src/components/home/home-page.tsx`
- Modify: `src/server/db/queries/home.ts` (delete `getCategorySnapshot`), `src/app/api/home/route.ts`, `src/lib/types.ts` (drop `categorySnapshot`)
- Modify: `src/i18n/messages/en.json`, `he.json`

**Interfaces:**
- Consumes: `HomeCategoryBreakdown`, `foldBreakdownForDonut`, `categoryDeltaVsAverage`, `DonutSlice` (Task 3); `buildTransactionsHref` (Task 4); formatters (Task 1).
- Produces: `WhereMoneyWentCard({ data: HomeCategoryBreakdown })`. `HomeSection`, `HomePayload` and `home.ts` lose `categorySnapshot` / `HomeCategorySnapshotItem` / `getCategorySnapshot`.

- [ ] **Step 1: Create `src/components/home/where-money-went-card.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { CardAction, CardShell } from "./card-shell";
import { cn } from "@/lib/utils";
import { formatSignedPercent, formatWholeCurrency } from "@/lib/formatters";
import {
  categoryDeltaVsAverage,
  foldBreakdownForDonut,
  type DonutSlice,
} from "@/lib/home-category-breakdown";
import { translateCategoryName } from "@/lib/i18n-data";
import { buildTransactionsHref } from "@/lib/transactions-url";
import type { Locale } from "@/i18n/routing";
import type {
  HomeCategoryBreakdown,
  HomeCategoryBreakdownGroup,
} from "@/lib/types";

// Beyond this many groups the smallest fold into "Other" in the donut only;
// the ranked list still shows every group.
const DONUT_MAX_SLICES = 7;
const UNCATEGORIZED_COLOR = "var(--muted-foreground)";
const OTHER_COLOR = "var(--input)";

function sliceColor(slice: DonutSlice): string {
  if (slice.isOther) return OTHER_COLOR;
  return slice.color ?? UNCATEGORIZED_COLOR;
}

export function WhereMoneyWentCard({ data }: { data: HomeCategoryBreakdown }) {
  const t = useTranslations("home");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;
  const allExpensesHref = buildTransactionsHref({
    month: data.month,
    kind: "expense",
    source: "all",
  });

  if (data.groups.length === 0) {
    return (
      <CardShell label={t("whereMoneyWent")}>
        <div className="flex flex-1 items-center justify-center py-10 text-sm text-muted-foreground">
          {t("whereEmpty")}
        </div>
      </CardShell>
    );
  }

  const slices = foldBreakdownForDonut(data.groups, DONUT_MAX_SLICES);
  const sliceName = (slice: DonutSlice) =>
    slice.isOther
      ? t("whereOther")
      : slice.name == null
        ? t("uncategorized")
        : translateCategoryName(slice.name, tCat);

  return (
    <CardShell
      label={t("whereMoneyWent")}
      action={<CardAction href={allExpensesHref}>{t("whereAllExpenses")}</CardAction>}
    >
      <div className="flex flex-1 flex-col gap-5 sm:flex-row sm:items-start">
        <figure className="relative mx-auto h-40 w-40 shrink-0 sm:mx-0">
          <figcaption className="sr-only">{t("whereMoneyWent")}</figcaption>
          {/* Before the chart so the tooltip paints above it. */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              {t("whereTotal")}
            </span>
            <span dir="ltr" className="font-serif text-lg tabular-nums">
              {formatWholeCurrency(data.total, locale)}
            </span>
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="amount"
                nameKey="key"
                innerRadius="66%"
                outerRadius="100%"
                stroke="var(--card)"
                strokeWidth={2}
                isAnimationActive={false}
              >
                {slices.map((slice) => (
                  <Cell key={slice.key} fill={sliceColor(slice)} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const slice = payload[0].payload as DonutSlice;
                  return (
                    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
                      <div className="font-medium tabular-nums text-popover-foreground">
                        <span dir="ltr">{formatWholeCurrency(slice.amount, locale)}</span>
                      </div>
                      <div className="text-muted-foreground">
                        {sliceName(slice)} · {Math.round(slice.share * 100)}%
                      </div>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </figure>

        <ul className="-mx-2 flex min-w-0 flex-1 flex-col">
          {data.groups.map((group) => (
            <BreakdownRow
              key={group.categoryId ?? "uncategorized"}
              group={group}
              month={data.month}
              isCurrentMonth={data.isCurrentMonth}
              averageMonths={data.averageMonths}
            />
          ))}
        </ul>
      </div>
    </CardShell>
  );
}

function BreakdownRow({
  group,
  month,
  isCurrentMonth,
  averageMonths,
}: {
  group: HomeCategoryBreakdownGroup;
  month: string;
  isCurrentMonth: boolean;
  averageMonths: number;
}) {
  const t = useTranslations("home");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;
  const name =
    group.name == null ? t("uncategorized") : translateCategoryName(group.name, tCat);
  const href =
    group.categoryId == null
      ? buildTransactionsHref({ month, kind: "expense", review: "uncategorized", source: "all" })
      : buildTransactionsHref({ month, categoryIds: group.categoryIds, kind: "expense", source: "all" });
  const childNames = group.children
    .slice(0, 3)
    .map((child) => translateCategoryName(child.name, tCat))
    .join(", ");

  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 rounded-xl px-2 py-2 outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/50"
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ backgroundColor: group.color ?? UNCATEGORIZED_COLOR }}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {t("whereShare", { percent: Math.round(group.share * 100) })}
            {childNames ? ` · ${childNames}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-end">
          <span dir="ltr" className="block text-sm tabular-nums">
            {formatWholeCurrency(group.amount, locale)}
          </span>
          <AverageComparison
            amount={group.amount}
            avg6={group.avg6}
            averageMonths={averageMonths}
            isCurrentMonth={isCurrentMonth}
          />
        </span>
      </Link>
    </li>
  );
}

function AverageComparison({
  amount,
  avg6,
  averageMonths,
  isCurrentMonth,
}: {
  amount: number;
  avg6: number | null;
  averageMonths: number;
  isCurrentMonth: boolean;
}) {
  const t = useTranslations("home");
  if (averageMonths === 0 || avg6 == null) return null;
  if (avg6 <= 0) {
    return <span className="block text-xs text-muted-foreground">{t("whereNew")}</span>;
  }
  // Month-to-date spend vs a full-month average would always look low early
  // in the month, so the current month shows progress toward the average.
  if (isCurrentMonth) {
    return (
      <span className="block text-xs tabular-nums text-muted-foreground">
        {t("whereOfAvgSoFar", { percent: Math.round((amount / avg6) * 100) })}
      </span>
    );
  }
  const delta = categoryDeltaVsAverage(amount, avg6);
  if (delta == null) return null;
  const rounded = Math.round(delta);
  const tone =
    rounded === 0
      ? "text-muted-foreground"
      : rounded > 0
        ? "text-[var(--status-over)]"
        : "text-[var(--status-on-track)]";
  return (
    <span className={cn("block text-xs tabular-nums", tone)}>
      {t("whereVsAvg", { value: formatSignedPercent(delta) })}
    </span>
  );
}
```

- [ ] **Step 2: Swap the card in `home-page.tsx`**

- Replace `import { CategorySnapshotCard } from "./category-snapshot-card";` with `import { WhereMoneyWentCard } from "./where-money-went-card";`
- Replace the `categoryBreakdown` case (with its comment) with:

```tsx
    case "categoryBreakdown":
      return data.categoryBreakdown ? (
        <WhereMoneyWentCard data={data.categoryBreakdown} />
      ) : null;
```

- Replace:

```tsx
    case "thisMonth":
    case "categorySnapshot":
      // Legacy payload fields that are no longer placed in the grid.
      return null;
```

with:

```tsx
    case "thisMonth":
      // Legacy payload field that is no longer placed in the grid.
      return null;
```

- Remove `categorySnapshot: t("whereMoneyWent"),` from `skeletonLabels` and `categorySnapshot: 220,` from `SKELETON_HEIGHTS`.

- [ ] **Step 3: Drop the `categorySnapshot` section**

- `git rm src/components/home/category-snapshot-card.tsx`
- `src/lib/types.ts`: remove `| "categorySnapshot"` from `HomeSection`, `categorySnapshot: HomeCategorySnapshotItem[] | null;` from `HomePayload`, and the whole `HomeCategorySnapshotItem` interface.
- `src/server/db/queries/home.ts`: delete the whole `getCategorySnapshot` function and `HomeCategorySnapshotItem,` from the type imports.
- `src/app/api/home/route.ts`: remove `getCategorySnapshot,` from the imports, `HomeCategorySnapshotItem,` from the type imports, `const CATEGORY_SNAPSHOT_LIMIT = 6;`, the whole `const categorySnapshot = safe<HomeCategorySnapshotItem[]>(...)` block, and `categorySnapshot,` from `payload`.

- [ ] **Step 4: Add the i18n strings**

In `en.json`, directly after `"pageTitle": "Home",` add:

```json
    "whereEmpty": "No spending in this month.",
    "whereOther": "Other",
    "whereShare": "{percent}% of expenses",
    "whereVsAvg": "{value} vs. avg",
    "whereOfAvgSoFar": "{percent}% of avg so far",
    "whereNew": "No earlier spend",
    "whereTotal": "Spent",
    "whereAllExpenses": "All expenses →",
```

In `he.json`, directly after `"pageTitle": "בית",` add:

```json
    "whereEmpty": "אין הוצאות בחודש הזה.",
    "whereOther": "אחר",
    "whereShare": "{percent}% מההוצאות",
    "whereVsAvg": "{value} לעומת הממוצע",
    "whereOfAvgSoFar": "{percent}% מהממוצע עד כה",
    "whereNew": "אין הוצאות קודמות",
    "whereTotal": "הוצאות",
    "whereAllExpenses": "כל ההוצאות ←",
```

- [ ] **Step 5: Automated verification**

Run: `npm run test:logic`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

Run: `npm run build` (dev server stopped)
Expected: build succeeds.

- [ ] **Step 6: Manual check (demo data dir)**

- [ ] English, light: donut by parent group (Food, Lifestyle, ...) with the month total in the middle; the ranked list shows amount, "n% of expenses" with up to three child names, and "n% of avg so far" for the current month.
- [ ] The donut total equals the Expenses tile.
- [ ] A past month: each row shows "+12% vs. avg" (red when above, green when below) or "No earlier spend".
- [ ] Hover a slice: tooltip with amount, name and share.
- [ ] Click a group row: `/transactions` opens on that month with the group's categories checked, Expenses kind and the "All sources" chip. Card purchases are listed.
- [ ] Click "Uncategorized" (current month): `/transactions` with the Uncategorized chip.
- [ ] Dark theme: slice gaps use the card color, the center label is legible.
- [ ] Hebrew: list reads RTL, amounts keep `₪` order, the "←" action arrow points the RTL way.
- [ ] 375 px: donut above the list, rows truncate names instead of overflowing.

- [ ] **Step 7: Commit**

```bash
git add src/components/home/where-money-went-card.tsx src/components/home/home-page.tsx src/server/db/queries/home.ts src/app/api/home/route.ts src/lib/types.ts src/i18n/messages/en.json src/i18n/messages/he.json
git diff --cached   # read it: synthetic values only
git commit -F - <<'EOF'
feat: add the where-money-went card to home

Replaces the Top categories card with a donut by parent category group
and a ranked list for the selected month. Each row shows the amount,
its share of expenses and how it compares to the group's average over
the completed months before it. For the current month the comparison
reads as progress toward the average, because month-to-date spend vs a
full-month average would always look low.

Rows open /transactions filtered to that month and exactly the
categories behind the group, across bank and card sources. The
Uncategorized bucket opens the uncategorized review filter.

The categorySnapshot payload section and getCategorySnapshot are
removed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Budget pace card with past-month verdicts

**Files:**
- Create: `src/lib/home-budget-pace.ts`
- Create: `src/components/home/budget-pace-card.tsx`
- Delete: `src/components/home/this-month-card.tsx`
- Modify: `src/components/home/home-page.tsx`
- Modify: `src/app/api/home/route.ts` (full rewrite below), `src/lib/types.ts` (drop `thisMonth`)
- Modify: `src/i18n/messages/en.json`, `he.json`
- Test: `scripts/test-home-analytics.mjs`

**Interfaces:**
- Consumes: `HomeBudgetPace` (Task 2); `formatMonthKey` (Task 1).
- Produces:
  - `interface BudgetPaceMessage { key: "spentThisMonth" | "spentInMonth" | "verdictOver" | "verdictABitOver" | "verdictAhead" | "verdictOnSchedule" | "verdictFinishedOver" | "verdictFinishedUnder"; amount: number | null; tone: "neutral" | "good" | "bad" }`
  - `budgetPaceMessage(input: { spent: number; budget: number; timeElapsedPercent: number; isPast: boolean }): BudgetPaceMessage`
  - `BudgetPaceCard({ data: HomeBudgetPace })`
  - `HomeSection`, `HomePayload` lose `thisMonth`; `HomeThisMonth` is removed.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-home-analytics.mjs`:

```js
test("budget pace messages cover current pace and past-month verdicts", async () => {
  const { budgetPaceMessage } = await import("../src/lib/home-budget-pace.ts");
  const current = (spent) => budgetPaceMessage({ spent, budget: 8000, timeElapsedPercent: 50, isPast: false });
  const past = (spent) => budgetPaceMessage({ spent, budget: 8000, timeElapsedPercent: 100, isPast: true });

  assert.deepEqual(
    budgetPaceMessage({ spent: 500, budget: 0, timeElapsedPercent: 50, isPast: false }),
    { key: "spentThisMonth", amount: null, tone: "neutral" }
  );
  assert.deepEqual(
    budgetPaceMessage({ spent: 500, budget: 0, timeElapsedPercent: 100, isPast: true }),
    { key: "spentInMonth", amount: null, tone: "neutral" }
  );
  assert.deepEqual(current(9000), { key: "verdictOver", amount: 1000, tone: "bad" });
  assert.deepEqual(current(6000), { key: "verdictABitOver", amount: null, tone: "bad" });
  assert.deepEqual(current(2400), { key: "verdictAhead", amount: null, tone: "good" });
  assert.deepEqual(current(4000), { key: "verdictOnSchedule", amount: null, tone: "good" });
  assert.deepEqual(past(8600), { key: "verdictFinishedOver", amount: 600, tone: "bad" });
  assert.deepEqual(past(7250), { key: "verdictFinishedUnder", amount: 750, tone: "good" });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --conditions react-server --experimental-transform-types --test scripts/test-home-analytics.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `home-budget-pace.ts`.

- [ ] **Step 3: Create `src/lib/home-budget-pace.ts`**

```ts
export interface BudgetPaceMessage {
  key:
    | "spentThisMonth"
    | "spentInMonth"
    | "verdictOver"
    | "verdictABitOver"
    | "verdictAhead"
    | "verdictOnSchedule"
    | "verdictFinishedOver"
    | "verdictFinishedUnder";
  amount: number | null;
  tone: "neutral" | "good" | "bad";
}

/**
 * The verdict under the spent figure. Current-month thresholds match the
 * previous this-month card: 20+ points ahead of time is "a bit over",
 * 10+ points behind is "ahead". Past months get a final verdict instead.
 */
export function budgetPaceMessage(input: {
  spent: number;
  budget: number;
  timeElapsedPercent: number;
  isPast: boolean;
}): BudgetPaceMessage {
  const { spent, budget, timeElapsedPercent, isPast } = input;
  if (budget <= 0) {
    return { key: isPast ? "spentInMonth" : "spentThisMonth", amount: null, tone: "neutral" };
  }
  if (isPast) {
    return spent > budget
      ? { key: "verdictFinishedOver", amount: spent - budget, tone: "bad" }
      : { key: "verdictFinishedUnder", amount: budget - spent, tone: "good" };
  }
  const pctSpent = (spent / budget) * 100;
  if (pctSpent > 100) {
    return { key: "verdictOver", amount: spent - budget, tone: "bad" };
  }
  const delta = pctSpent - timeElapsedPercent;
  if (delta >= 20) return { key: "verdictABitOver", amount: null, tone: "bad" };
  if (delta <= -10) return { key: "verdictAhead", amount: null, tone: "good" };
  return { key: "verdictOnSchedule", amount: null, tone: "good" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --conditions react-server --experimental-transform-types --test scripts/test-home-analytics.mjs`
Expected: PASS.

- [ ] **Step 5: Create `src/components/home/budget-pace-card.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ArrowUp } from "lucide-react";
import { CardAction, CardShell } from "./card-shell";
import { cn } from "@/lib/utils";
import { formatCurrency, formatMonthKey } from "@/lib/formatters";
import { budgetPaceMessage, type BudgetPaceMessage } from "@/lib/home-budget-pace";
import type { Locale } from "@/i18n/routing";
import type { HomeBudgetPace } from "@/lib/types";

const TONE_CLASS: Record<BudgetPaceMessage["tone"], string> = {
  neutral: "text-muted-foreground",
  good: "text-[var(--status-on-track)]",
  bad: "text-[var(--status-over)]",
};

export function BudgetPaceCard({ data }: { data: HomeBudgetPace }) {
  const t = useTranslations("home");
  const locale = useLocale() as Locale;
  const {
    month,
    spent,
    budget,
    deltaVsLastMonth,
    daysUntilPayday,
    timeElapsedPercent,
    isPast,
  } = data;
  const hasBudget = budget > 0;
  const pctSpent = hasBudget ? (spent / budget) * 100 : 0;
  const message = budgetPaceMessage({ spent, budget, timeElapsedPercent, isPast });
  const verdict = t(message.key, {
    amount: formatCurrency(message.amount ?? 0),
    month: formatMonthKey(month, locale, "long", false),
  });

  return (
    <CardShell
      label={t("budgetPaceTitle")}
      action={<CardAction href="/budget">{t("budgetDetail")}</CardAction>}
    >
      <Link
        href="/budget"
        className="group -m-2 flex flex-1 flex-col gap-5 rounded-2xl p-2 outline-none transition-colors hover:bg-accent/30 focus-visible:bg-accent/40"
      >
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div className="flex flex-col">
            <span className="font-serif text-3xl leading-none tracking-tight md:text-4xl">
              <span dir="ltr">{formatCurrency(spent)}</span>
            </span>
            <span className={cn("mt-2 text-sm", TONE_CLASS[message.tone])}>{verdict}</span>
          </div>
          {deltaVsLastMonth != null && (
            <DeltaPill value={deltaVsLastMonth} isPast={isPast} />
          )}
        </div>

        {hasBudget && (
          <div className="space-y-2">
            <ProgressBar
              percent={pctSpent}
              markPercent={isPast ? null : timeElapsedPercent}
              isOver={pctSpent > 100}
            />
            <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
              <span>
                {t("percentOfBudget", {
                  percent: Math.round(pctSpent),
                  budget: formatCurrency(budget),
                })}
              </span>
              {daysUntilPayday != null && (
                <span>{t("daysToPayday", { days: daysUntilPayday })}</span>
              )}
            </div>
          </div>
        )}

        {!hasBudget && daysUntilPayday != null && (
          <div className="text-xs text-muted-foreground">
            {t("daysToPayday", { days: daysUntilPayday })}
          </div>
        )}
      </Link>
    </CardShell>
  );
}

function DeltaPill({ value, isPast }: { value: number; isPast: boolean }) {
  const t = useTranslations("home");
  const rounded = Math.round(value);
  const isUp = rounded > 0;
  const isFlat = rounded === 0;
  const Icon = isUp ? ArrowUp : ArrowDown;
  const cls = isFlat
    ? "text-muted-foreground bg-muted/60"
    : isUp
      ? "text-[var(--status-over)] bg-[var(--status-over)]/10"
      : "text-[var(--status-on-track)] bg-[var(--status-on-track)]/10";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums ${cls}`}
      title={t(isPast ? "comparedToPreviousMonth" : "comparedToLastMonth")}
    >
      {!isFlat && <Icon className="h-3 w-3" />}
      {t(isPast ? "vsPreviousMonth" : "vsLastMonth", { percent: Math.abs(rounded) })}
    </span>
  );
}

function ProgressBar({
  percent,
  markPercent,
  isOver,
}: {
  percent: number;
  markPercent: number | null;
  isOver: boolean;
}) {
  const fillClass = isOver
    ? "bg-[var(--status-over)]"
    : "bg-[var(--status-on-track)]";
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={`h-full ${fillClass}`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
      {markPercent != null && (
        <div
          className="absolute top-0 bottom-0 w-px bg-foreground/40"
          style={{ insetInlineStart: `${Math.min(100, Math.max(0, markPercent))}%` }}
          aria-hidden
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Swap the card in `home-page.tsx`**

- Replace `import { ThisMonthCard } from "./this-month-card";` with `import { BudgetPaceCard } from "./budget-pace-card";`
- Replace the `budgetPace` case (with its comment) with:

```tsx
    case "budgetPace":
      return data.budgetPace ? <BudgetPaceCard data={data.budgetPace} /> : null;
```

- Delete:

```tsx
    case "thisMonth":
      // Legacy payload field that is no longer placed in the grid.
      return null;
```

- Remove `thisMonth: t("budgetPaceTitle"),` from `skeletonLabels` and `thisMonth: 180,` from `SKELETON_HEIGHTS`.
- `git rm src/components/home/this-month-card.tsx`

- [ ] **Step 7: Drop `thisMonth` from the types and rewrite the route**

In `src/lib/types.ts`: remove `| "thisMonth"` from `HomeSection`, `thisMonth: HomeThisMonth | null;` from `HomePayload`, and the whole `HomeThisMonth` interface.

Replace `src/app/api/home/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { getLastCompleteMonthEnd } from "@/server/lib/home-analytics";
import {
  getBankHealth,
  getBudgetPace,
  getCashFlowTrend,
  getCategoryBreakdown,
  getHomeKpis,
  getNeedsAttentionCounts,
  getRecentTransactionsForHome,
  getSpendingStats,
} from "@/server/db/queries/home";
import { getNextRunAt } from "@/server/sync/scheduler";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { toLocalISODate } from "@/server/lib/date-utils";
import { parseHomeMonth } from "@/lib/home-month";
import type {
  HomeBankHealthItem,
  HomeBudgetPace,
  HomeCategoryBreakdown,
  HomeHistoricalTrendPoint,
  HomeKpis,
  HomeNeedsAttention,
  HomePayload,
  HomeRecentTransaction,
  HomeSection,
  HomeSectionError,
  HomeSpendingStats,
} from "@/lib/types";

const TREND_MONTHS = 12;
const STATS_DEFAULT_MONTHS = 6;
const RECENT_TXN_LIMIT = 8;

function safe<T>(
  section: HomeSection,
  errors: HomeSectionError[],
  fn: () => T
): T | null {
  try {
    return fn();
  } catch (err) {
    errors.push({
      section,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const now = new Date();

  const parsedMonth = parseHomeMonth(
    new URL(request.url).searchParams.get("month"),
    now
  );
  if (!parsedMonth.ok) {
    return NextResponse.json(
      {
        error:
          parsedMonth.error === "future_month"
            ? "month cannot be in the future"
            : "month must be formatted as YYYY-MM",
      },
      { status: 400 }
    );
  }
  const selected = parsedMonth.month;

  const errors: HomeSectionError[] = [];

  const kpis = safe<HomeKpis>("kpis", errors, () =>
    getHomeKpis(workspaceId, selected)
  );

  const budgetPace = safe<HomeBudgetPace>("budgetPace", errors, () =>
    getBudgetPace(workspaceId, selected, now)
  );

  const categoryBreakdown = safe<HomeCategoryBreakdown>(
    "categoryBreakdown",
    errors,
    () => getCategoryBreakdown(workspaceId, selected)
  );

  const historicalTrend = safe<HomeHistoricalTrendPoint[]>(
    "historicalTrend",
    errors,
    () => getCashFlowTrend(workspaceId, selected, TREND_MONTHS, now)
  );

  const recentTransactions = safe<HomeRecentTransaction[]>(
    "recentTransactions",
    errors,
    () => getRecentTransactionsForHome(workspaceId, RECENT_TXN_LIMIT)
  );

  const spendingStats = safe<HomeSpendingStats>("spendingStats", errors, () => {
    const statsTo = toLocalISODate(getLastCompleteMonthEnd(now));
    return getSpendingStats(workspaceId, statsTo, STATS_DEFAULT_MONTHS);
  });

  const needsAttention = safe<HomeNeedsAttention>(
    "needsAttention",
    errors,
    () =>
      getNeedsAttentionCounts(workspaceId, {
        from: selected.from,
        to: selected.to,
      })
  );

  const bankHealth = safe<HomeBankHealthItem[]>("bankHealth", errors, () =>
    getBankHealth(workspaceId)
  );

  const payload: HomePayload = {
    month: selected.key,
    kpis,
    budgetPace,
    categoryBreakdown,
    historicalTrend,
    recentTransactions,
    spendingStats,
    needsAttention,
    bankHealth,
    nextScheduledSync: getNextRunAt(),
    errors,
  };

  return NextResponse.json(payload);
}
```

- [ ] **Step 8: Add the i18n strings**

In `en.json`, directly after `"pageTitle": "Home",` add:

```json
    "verdictFinishedUnder": "Finished {amount} under target",
    "verdictFinishedOver": "Finished {amount} over target",
    "spentInMonth": "Spent in {month}",
    "vsPreviousMonth": "{percent}% vs. previous month",
```

In `he.json`, directly after `"pageTitle": "בית",` add:

```json
    "verdictFinishedUnder": "הסתיים {amount} מתחת ליעד",
    "verdictFinishedOver": "הסתיים {amount} מעל היעד",
    "spentInMonth": "הוצאות ב{month}",
    "vsPreviousMonth": "{percent}% לעומת החודש הקודם",
```

- [ ] **Step 9: Automated verification**

Run: `npm run test:logic`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors (no remaining reference to `HomeThisMonth`, `thisMonth` or `getPeriodTotal` in the home route).

Run: `npm run lint`
Expected: no errors.

Run: `npm run build` (dev server stopped)
Expected: build succeeds.

- [ ] **Step 10: Manual check (demo data dir, `monthly_target` 9000, payday 10)**

- [ ] English, current month: "Budget pace" card with the spent figure, an on-schedule style verdict, a progress bar with the time marker, "n% of ₪9,000.00" and "N days to payday".
- [ ] A past month: verdict "Finished ₪X under target" (green) or "over target" (red), no time marker, no payday line, the pill reads "n% vs. previous month".
- [ ] Clear the target in Settings (or set `monthly_target` to 0): the current month shows "Spent this month", a past month shows "Spent in <Month>".
- [ ] Dark theme and Hebrew (light and dark): the marker sits at the RTL position, "הוצאות באוקטובר" style text reads naturally.
- [ ] 375 px: the card stacks under Where money went with no overflow.

- [ ] **Step 11: Commit**

```bash
git add src/lib/home-budget-pace.ts src/components/home/budget-pace-card.tsx src/components/home/home-page.tsx src/app/api/home/route.ts src/lib/types.ts src/i18n/messages/en.json src/i18n/messages/he.json scripts/test-home-analytics.mjs
git diff --cached   # read it: synthetic values only
git commit -F - <<'EOF'
feat: add the budget pace card with past-month verdicts

The this-month hero becomes a Budget pace card that follows the month
picker. For the current month it keeps the progress bar, time marker,
pace verdict and days to payday. For a past month it shows the final
spent vs monthly_target with a verdict (finished under or over target)
and no time marker or payday.

The verdict logic moves to a pure budgetPaceMessage helper with tests.
The legacy thisMonth section, its English pacePhrase and month label,
and the getPeriodTotal path in the home route are removed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Averages, recent transactions, cleanup and final verification

**Files:**
- Modify: `src/server/db/queries/home.ts` (`getRecentTransactionsForHome`)
- Modify: `src/app/api/home/route.ts` (stats window, recent `to`)
- Modify: `src/components/home/spending-stats-card.tsx:41,57`
- Modify: `src/i18n/messages/en.json`, `he.json` (remove dead keys)
- Modify: `AGENTS.md:167`
- Test: `scripts/test-home-analytics.mjs`

**Interfaces:**
- Consumes: Task 2 fixture, `selected` in the route (Task 8 version).
- Produces: `getRecentTransactionsForHome(workspaceId: number, limit: number, to: string): HomeRecentTransaction[]`

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-home-analytics.mjs`:

```js
test("recent transactions for a past month stop at the end of that month", async () => {
  const { workspaceId } = await getHomeFixture();
  const { getRecentTransactionsForHome } = await import("../src/server/db/queries/home.ts");

  const rows = getRecentTransactionsForHome(workspaceId, 3, "2026-08-31");

  assert.deepEqual(rows.map((row) => row.date), ["2026-08-20", "2026-08-14", "2026-08-12"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --conditions react-server --experimental-transform-types --test scripts/test-home-analytics.mjs`
Expected: FAIL; the dates come from October (the `to` argument is ignored).

- [ ] **Step 3: Scope recent transactions**

In `src/server/db/queries/home.ts`, replace the whole `getRecentTransactionsForHome` function with:

```ts
export function getRecentTransactionsForHome(
  workspaceId: number,
  limit: number,
  to: string
): HomeRecentTransaction[] {
  const rows = getDb()
    .prepare(
      `SELECT t.id, t.date, t.description, t.charged_amount as chargedAmount,
              t.charged_currency as chargedCurrency, t.kind,
              c.name as categoryName, c.color as categoryColor
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.workspace_id = ? AND t.status = 'completed' AND t.kind != 'transfer'
         AND t.date <= ?
         AND ${EXCLUDE_TRANSFERS_SQL}
       ORDER BY t.date DESC, t.id DESC
       LIMIT ?`
    )
    .all(workspaceId, to, limit) as Array<{
    id: number;
    date: string;
    description: string;
    chargedAmount: number;
    chargedCurrency: string | null;
    kind: "expense" | "income" | "transfer";
    categoryName: string | null;
    categoryColor: string | null;
  }>;
  return rows;
}
```

- [ ] **Step 4: Point the route at the selected month**

In `src/app/api/home/route.ts`, replace:

```ts
    () => getRecentTransactionsForHome(workspaceId, RECENT_TXN_LIMIT)
```

with:

```ts
    () =>
      getRecentTransactionsForHome(workspaceId, RECENT_TXN_LIMIT, selected.to)
```

and replace:

```ts
    const statsTo = toLocalISODate(getLastCompleteMonthEnd(now));
```

with:

```ts
    // Averages end at the month before the selected one, so only completed
    // months count and a past month's averages describe the time before it.
    const statsTo = toLocalISODate(
      getLastCompleteMonthEnd(new Date(selected.year, selected.monthIndex, 1))
    );
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:logic`
Expected: PASS.

- [ ] **Step 6: Let the Averages card size to its content**

In `src/components/home/spending-stats-card.tsx`, replace both occurrences of:

```tsx
<CardShell label={t("spendingStatsTitle")} className="min-h-[560px]">
```

with:

```tsx
<CardShell label={t("spendingStatsTitle")}>
```

- [ ] **Step 7: Remove dead strings**

For each key below, confirm it has no remaining user, then delete it from the `home` object of both `en.json` and `he.json`:

Run: `git grep -nE 't\("(thisMonthLabel|cashFlowTitle|topCategoriesTitle|allCategories|last6Months)"' -- src`
Expected: no output.

Keys to delete in both files: `thisMonthLabel`, `cashFlowTitle`, `topCategoriesTitle`, `allCategories`, `last6Months`. If the search prints a hit, keep that key.

- [ ] **Step 8: Update `AGENTS.md`**

Replace the line:

```markdown
- `/`: Home. Cash flow, this month, historical trend, spending stats (selectable month range), category snapshot, needs attention, recent transactions.
```

with:

```markdown
- `/`: Home, scoped to `?month=YYYY-MM` (defaults to the current month). KPI tiles (income, expenses, net, savings rate with deltas and 6-month averages), 12-month cash-flow chart, where money went, budget pace, averages (selectable month range), needs attention, recent transactions.
```

- [ ] **Step 9: Full automated verification**

Run: `npm run test:logic`
Expected: PASS (includes the en/he parity and no-em-dash guard).

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

Run: `npm run build` (dev server stopped)
Expected: build succeeds.

Run (scans the files this plan created or rewrote for the em dash character, U+2014):

```bash
node -e "const fs=require('fs');const d=String.fromCharCode(0x2014);const hits=process.argv.slice(1).filter(f=>fs.readFileSync(f,'utf8').includes(d));console.log(hits.length?hits.join('\n'):'none')" src/lib/home-month.ts src/lib/home-kpis.ts src/lib/home-category-breakdown.ts src/lib/home-budget-pace.ts src/lib/home-needs-attention.ts src/lib/transactions-url.ts src/lib/transaction-review-filter.ts src/components/home/home-page.tsx src/components/home/kpi-tiles.tsx src/components/home/home-month-picker.tsx src/components/home/cash-flow-chart-card.tsx src/components/home/where-money-went-card.tsx src/components/home/budget-pace-card.tsx src/components/home/needs-attention-card.tsx src/app/api/home/route.ts src/server/db/queries/home.ts
```

Expected: `none`.

- [ ] **Step 10: Final manual check (demo data dir)**

xlsx mode, English, light:
- [ ] Order on desktop (lg): KPI tiles, chart (full width), Where money went (7) beside Budget pace (5), Averages (7) beside Needs attention (5), Recent activity full width.
- [ ] md width (about 800 px): two columns; mobile (375 px): one column, no horizontal scroll anywhere.
- [ ] Averages card has no forced empty space at the bottom.
- [ ] Current month and a past month: every card follows the picker; for a past month, Recent activity ends at that month and the Averages window ends the month before it.
- [ ] Clicking a chart month and a category row both work (Tasks 6 and 7 checks still pass).

Repeat in dark theme, then Hebrew light and dark.

Optional scraper-mode slot check (still synthetic). Stop the server, then in PowerShell from the repo root:

```powershell
$env:SPENT_DATA_DIR = "$env:TEMP\spent-home-demo"
node -e "const D=require('better-sqlite3');const db=new D(require('path').join(process.env.SPENT_DATA_DIR,'spent.db'));db.prepare(\"INSERT INTO bank_credentials (workspace_id, provider, label, credentials_encrypted, iv, auth_tag) VALUES (1, 'isracard', 'Demo', x'00', x'00', x'00')\").run();db.prepare(\"UPDATE workspace_settings SET value='scraper' WHERE workspace_id=1 AND key='data_source_mode'\").run();"
npm run dev
```

- [ ] Recent activity spans 7 and Bank connections (5) sits beside it, showing "Never synced". Do not click Sync (the credential is a dummy).

- [ ] **Step 11: Commit**

```bash
git add src/server/db/queries/home.ts src/app/api/home/route.ts src/components/home/spending-stats-card.tsx src/i18n/messages/en.json src/i18n/messages/he.json AGENTS.md scripts/test-home-analytics.mjs
git diff --cached   # read it: synthetic values only
git commit -F - <<'EOF'
feat: scope home averages and recent activity to the selected month

Completes the month-scoped home page:

- Averages end at the month before the selected month, so they only
  use completed months and describe the time leading up to a past month.
- Recent activity lists the latest rows up to the end of the selected
  month (unchanged for the current month).
- The Averages card no longer reserves a fixed 560px height.
- Strings left unused by the removed cards are deleted from both
  locales, and AGENTS.md describes the new home page.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
