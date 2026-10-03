# Home page redesign: design

Date: 2026-10-03
Status: approved
Order: sub-project 2 of 3 (after CAL import fix, before trips)

## Goal

The home page should show the household's global picture at a glance:
- income and expenses first
- then the trend
- then where the money went, budget pace and averages

Today the large hero shows only month-to-date expenses vs a target. Income and net sit in a small side card, cash-flow numbers repeat across three cards, there is no month navigation, and the trend chart is a 96px hand-drawn SVG with no axis.

## Layout

There is a 12-column grid on `lg`. On `md` it becomes two columns, and on mobile one column.

| Row | Content | Span (lg) |
|---|---|---|
| Header | Title, month picker, Categorize, Sync or Import | full |
| 1 | KPI tiles: Income, Expenses, Net, Savings rate | 4 x 3 (2x2 on mobile) |
| 2 | 12-month cash-flow chart | 12 |
| 3 | Where money went | 7 |
| 3 | Budget pace | 5 |
| 4 | Averages | 7 |
| 4 | Needs attention | 5 |
| 5 | Recent transactions | 7 (12 in xlsx mode) |
| 5 | Bank health (scraper mode only) | 5 |

Removed:
- `CashFlowCard`, which is merged into the KPI tiles.
- `HistoricalTrendCard`, which is replaced by the chart.

## Components

### Month picker
- Shows `‹ Oct 2026 ›`, reusing the visual pattern of `PeriodSelector` from the budget page.
- The state lives in the URL as `?month=YYYY-MM`, defaulting to the current month. Next is disabled past the current month.
- `/api/home` accepts `month` and every section is computed for that month.

### KPI tiles
- Each tile shows:
  - the value, large and in serif, matching the current hero typography
  - delta vs the previous month
  - the 6-month average as a muted line, computed over the 6 completed months before the selected month (`getLastCompleteMonthEnd` semantics), so a half-finished month never skews it
- All figures use `completed` transactions only and the existing money semantics in `AGENTS.md`: card bill payments are `transfer`, and `Transfers` nets by signed amount.
- **Net** is colored by sign. **Savings rate** = Net / Income, shown as "n/a" when income is 0.
- **Current month:**
  - The subtitle reads "so far (day 3 of 31)".
  - The delta compares against the same day range of last month, using the existing `deltaVsLastMonth` logic.
- **Past months:** the delta compares full months.

### 12-month cash-flow chart
- Recharts, which is already a dependency.
- Grouped bars for income and expenses, plus a net line, ending at the selected month.
- The y-axis is formatted in ₪, with light gridlines and a tooltip showing In, Out and Net.
- The selected month is highlighted. Clicking a month sets `?month`.
- Follow the dataviz skill for colors, both themes and accessibility.

### Where money went
- A donut by parent category group, falling back to leaf categories when a workspace has no parent groups.
- A ranked list with amount, share of expenses, and delta vs the 6-month category average.
- A row click opens `/transactions` filtered to that category and month.

### Budget pace
- The current `ThisMonthCard` content: spent vs `monthly_target`, a progress bar with a time-elapsed marker, the pace phrase and days to payday.
- For a past month it shows the final spent vs the target and a verdict, with no time marker or payday.

### Averages
- The existing `SpendingStatsCard`: a 3..N month slider, average income, expense and saving, and averages per category.
- Remove `min-h-[560px]`.

### Needs attention
- Uncategorized, low confidence and flagged rows, each linking to `/transactions` with the matching review filter.
- Check `src/lib/transaction-review-filter.ts` for the supported filter params.
- The trips sub-project later adds a "Needs a trip" row.

### Recent transactions and bank health
- Unchanged, except for placement.

## Data and API

`GET /api/home?month=YYYY-MM`:
- Validate the format and reject future months with a 400.
- Payload changes:
  - Replace `cashFlow` with `kpis`: `{ income, expenses, net, savingsRate, prev: {...}, avg6: {...}, isCurrentMonth, dayOfMonth, daysInMonth }`.
  - `historicalTrend` becomes 12 months ending at the selected month.
  - `thisMonth` is renamed to `budgetPace` and gains `isPast`.
  - Add `categoryBreakdown`: per parent group, with children, amount, share and `avg6`.
  - The other sections keep their shape.
- Each section stays wrapped in `safe()`.

## Bug fixes included

- **Low-confidence count.** Use `ai_confidence <= 4` (1-7 scale), matching `needsReview` in `src/server/sync/categorization.ts`. The current `< 0.5` is always 0.
- **Locale-aware labels.** Month labels use the active locale instead of hard-coded `en-US`.
- **i18n.** All new strings go in both `src/i18n/messages/en.json` and `he.json`.

## Testing

- Extend `scripts/test-home-analytics.mjs`:
  - KPI math, including savings rate with zero income
  - previous-month and 6-month-average values
  - the `month` param
  - the 6-month average uses completed months only
  - low-confidence threshold
- `npm run test:logic`, `npm run lint`, `npm run build`.
- Run the app and check, in light and dark themes and at mobile width:
  - the current month and a past month
  - an xlsx-mode workspace
  - clicking a chart month and a category row

## Out of scope

- Budget editing on home.
- Filtering on `transactions.is_excluded`. It is an unfinished feature that nothing sets (see `AGENTS.md`), so home does not build on it.
- Custom date ranges beyond a single month.
