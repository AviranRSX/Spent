# Trips: design

Date: 2026-10-03
Status: approved
Order: sub-project 3 of 3 (after CAL import fix and home redesign)

## Goal

See what each vacation cost in total and where the money went inside it. Navigation is a tab per trip.

A trip is a **label on top of** each transaction's normal category. It is not a category:
- A restaurant in Prague stays `Restaurants`, so category budgets and stats stay correct.
- It also belongs to the "Prague" trip, so the trip shows its full cost by category.

Patterns the rules must handle (illustrative trips with invented details):
- **Short trip abroad (CZK).** Charges in CZK, one EUR exchange during the trip, and ILS app charges. The AI labeled restaurants, groceries and the metro as `Travel`.
- **Long-haul trip (JPY).** Flight paid in USD weeks before departure, hotels prepaid in JPY on several dates, tours in USD.
- **Online purchases** in foreign currency (marketplaces, subscriptions) can recur in any month and must not look like trips.

## Data model

New migration `025_trips.sql`:

```sql
CREATE TABLE trips (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  country TEXT,                 -- display name, user editable
  currency TEXT NOT NULL,       -- ISO 4217; 'ILS' for local trips
  start_date TEXT NOT NULL,     -- YYYY-MM-DD
  end_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('suggested', 'confirmed', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (end_date >= start_date)
);

-- Manual decisions. trip_id NULL means "not part of any trip".
CREATE TABLE trip_assignments (
  transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  trip_id INTEGER REFERENCES trips(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- The primary key on `transaction_id` guarantees that a transaction belongs to at most one trip.
- Deleting a trip removes its manual assignments. Its automatic members simply stop matching.

### Categories

The same migration does the following for every workspace:
- Creates the expense parent group **Trips & Travel**.
- Creates the leaves **Flights** and **Travel Insurance** under it, with `budget_mode = 'tracking'`.
- Moves the existing **Travel** leaf under it.

The descriptions used by the AI prompt:
- **Flights:** airline tickets and flight booking sites.
- **Travel Insurance:** insurance bought for a trip.
- **Travel:** lodging, tours, car rental and travel agencies. Not flights, not insurance, and not everyday spending abroad (categorize that by what it is).

Also update:
- the new-workspace seed in `src/server/db/queries/workspaces.ts`
- `SEEDED_CATEGORY_PARENTS` in `src/server/db/queries/categories.ts`
- the Hebrew labels in `he.json`

`src/server/ai/prompts.ts` gets this rule: "Spending abroad is categorized by what it is (Restaurants, Groceries, Transport, Shopping). Use Travel only for lodging, tours and rentals."

### Currency normalization

- Stored `original_currency` values are raw (`Ft`, `₩`, `$`) and are part of the dedup hash, so they are **not** rewritten.
- A pure `normalizeCurrency(raw)` in `src/lib/currency.ts` maps:
  - symbols and Hebrew names to ISO codes (`₪`/`ש"ח`/`NIS` → ILS, `$` → USD, `€` → EUR, `£` → GBP, `¥` → JPY, `Ft` → HUF, `₩` → KRW, `฿` → THB, `zł` → PLN, `Kč` → CZK, `₺` → TRY)
  - 3-letter codes, uppercased, unchanged
- Trip logic and display use it.
- `countryForCurrency(code)` gives a default country (CZK → Czechia, JPY → Japan, GBP → United Kingdom, THB → Thailand, USD → United States, and so on). It returns empty for currencies shared by many countries, such as EUR.

## Membership rules

A pure function `resolveTripMembership(transactions, trips, assignments)` in `src/lib/trips/membership.ts` returns, per transaction:
- `{ tripId, reason: 'manual' | 'during' | 'pre' }`
- or a queue entry with suggested trip ids.

Only `confirmed` trips take part. Transactions with `kind = 'transfer'` are ignored. `is_excluded` is not used (see `AGENTS.md`).

"Online" means the description matches the editable merchant list in `src/lib/trips/online-merchants.ts` (a broad list of well-known marketplaces, app stores, payment wallets and subscription services), or the category is Subscriptions.

The rules are evaluated in order, and the first match wins:

1. **Manual.** A row in `trip_assignments` decides: the given trip, or no trip.
2. **During the trip.** The trip currency is not ILS, the transaction currency is not ILS, it is not online, and its date is in `[start - 2d, end + 2d]`.
   - The trip's currency doesn't have to match. This catches the EUR exchange during the CZK trip.
   - If several trips match, prefer the one whose currency equals the transaction's. If that's still tied, the transaction goes to the queue.
3. **Before the trip.** The transaction currency equals the trip currency, is not ILS or USD, is not online, and the date is in `[start - 180d, start)`.
   - If several trips match, the one with the nearest upcoming start wins. If that's still tied, the transaction goes to the queue.
4. **Needs a trip** (queue). These go to the queue:
   - a transaction in Flights, Travel or Travel Insurance with no trip from rules 1 to 3
   - an ambiguous match from rules 2 and 3

   Suggested trips for a queue item: confirmed trips whose date range contains the transaction date, or whose start is within 180 days after it. Same-currency trips rank first, then the nearest start.

Membership is computed on read. Data volume is thousands of rows, so no caching is needed. A trip's total is `-SUM(charged_amount)` over its `completed` members, so refunds on the card reduce the total. Pending members are listed but not counted, matching the summary rule in `AGENTS.md`.

## Trip detection

`detectTripSuggestions(workspaceId)`:
- **Candidates:** transactions with no trip (by the rules above), not marked "no trip", a normalized currency other than ILS, not online, and `kind = 'expense'`.
- **Clusters:** group the candidates by currency and sort by date. Split a group wherever the gap is more than 3 days. A cluster needs at least 3 transactions.
- **Skips:** clusters that overlap the date range of any trip with the same currency, in any status. This way a dismissed suggestion doesn't come back.
- **Insert:** a `suggested` trip named `{country or currency} {Mon YYYY}`, with country from `countryForCurrency` and dates equal to the cluster span.

Detection runs:
- at the end of a sync
- after an import commit
- when the Trips page opens (`POST /api/trips/detect`)

Domestic trips (ILS) are never auto-detected. The user creates them and assigns transactions by multi-select.

## API

All routes are workspace scoped, like the existing ones.

- `GET /api/trips`: confirmed trips with total, days and per-day cost; suggested trips; `needsTripCount`.
- `POST /api/trips`: create a trip, confirmed by default.
- `PATCH /api/trips/[id]`: edit the name, country, currency or dates; confirm or dismiss.
- `DELETE /api/trips/[id]`.
- `GET /api/trips/[id]`: the trip detail, with:
  - total, days, per day, and the pre-trip vs during split
  - a breakdown by leaf category, with parent group color
  - a daily series for the trip dates
  - the member transactions with their `reason`
- `POST /api/trips/detect`.
- `GET /api/trips/needs-trip`: the queue, with suggestions.
- `POST /api/trips/assignments` with `{ transactionIds: number[], tripId: number | null }`: manual assign, or "not a trip" when null.
- `DELETE /api/trips/assignments` with `{ transactionIds: number[] }`: revert to the automatic rules.

## UI

### Sidebar
- A new **Trips** item (plane icon) between Credit card and Settings.
- A badge shows `needsTripCount` when it is greater than 0.

### Trips page (`/trips`)
- A tab row built with `@/components/ui/tabs` (base-ui), scrolling horizontally on overflow:
  - **All trips:** cards for confirmed trips, newest first, showing name, country, dates, total and per day. Suggested trips appear above them with Confirm, Edit and Dismiss, and there is a **New trip** button.
  - **One tab per confirmed trip**, newest first. The selected tab lives in the URL as `?trip=<id>`.
  - **Needs a trip** with a count badge. Each row shows the transaction, its suggested trips as one-click chips, **New trip…**, and **Not a trip**.
- **Trip tab** contents:
  - **Header:** name, country, dates, days and currency, with Edit and Delete.
  - **KPIs:** Total, Per day, Before the trip, During the trip.
  - **Breakdown by category:** Flights, Travel, Restaurants, Groceries, Shopping, and so on.
  - **Daily spend chart:** Recharts bars over the trip dates. Follow the dataviz skill.
  - **Transaction list** grouped into "Before the trip" and "During the trip". Each row shows its category badge, and a remove action that writes a "no trip" assignment.
  - An **Add transactions** link to `/transactions` filtered to the trip date range.
  - A **Re-categorize Travel transactions** action. It runs the existing AI categorize preview/apply flow on this trip's members that are still categorized `Travel`, so the trip's restaurants become `Restaurants` and stay in the trip.

### Transactions page
- **Multi-select:**
  - A checkbox column, with a header checkbox for the current page.
  - When at least one row is selected, a sticky bulk bar appears with **Assign to trip…** (a popover with confirmed trips plus **New trip…**), **Remove from trip**, and **Mark not a trip**.
  - This is what makes local (ILS) trips possible.
- A small **trip badge** on rows that belong to a trip.
- **Category change prompt:** when the user sets a category to Flights, Travel or Travel Insurance and the transaction has no trip, a dialog offers the suggested trips, **New trip…**, and **Skip**. Skip leaves it in the queue.

### Home
- The Needs attention card gains a **Needs a trip** row linking to `/trips?tab=needs-trip`.

### i18n
- All strings go in `en.json` and `he.json`.

## Testing

- **New `scripts/test-trips.mjs`, added to `test:logic`:**
  - `normalizeCurrency` and `countryForCurrency`
  - the online detection
  - each membership rule and tie-break, using synthetic fixtures modelled on the patterns above (CZK trip with an EUR exchange, JPY prepay plus a USD flight, monthly online purchases)
  - detection: cluster splitting, the 3-transaction minimum, the dismissed-overlap skip
- **API smoke checks** for create, assign, revert and detect.
- **Manual check in the running app:**
  - the sidebar badge and tabs
  - a trip tab, in light and dark themes and at mobile width
  - assigning a local trip by multi-select
  - the category-change prompt
  - re-categorizing a trip's `Travel` rows

## Out of scope

- Per-trip budgets.
- Splitting one transaction across trips.
- Exchange-rate analytics.
- Multiple currencies per trip (rule 2 already covers spending in a second currency during the trip).
