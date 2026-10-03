<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes. APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Spent: project context

Shared context for any coding agent (Claude Code, Codex, others) working on this codebase. This file is the single source of truth; `CLAUDE.md` imports it.

## What Spent is

Spent is a local-only home finance analysis app for Israeli households. The user exports transaction files from every bank account and credit card the household uses, loads them into Spent, and Spent categorizes every transaction and turns the combined data into a clear picture of the home's money.

The product goal is to answer three questions for the household:

1. **What comes in?** Salary, side income, investment income, refunds, incoming transfers.
2. **What goes out, and on what?** Spending broken down by category and category group, across all cards and accounts, month over month.
3. **How much do we save?** Income minus expenses (see "Savings" below).

Everything runs on the user's own machine. It is an open-source project meant for self-hosting. The maintainer is based in Israel and builds it for their own household first, then publishes it.

### Core loop

1. **Import.** The user drops `.xls` / `.xlsx` exports from their banks and card companies. Spent auto-detects which institution each file is from, parses it, previews rows, flags duplicates, and commits.
2. **Categorize.** Every new transaction gets a category through a layered pipeline: merchant memory, then a majority vote over the household's own history, then an AI provider for the rest. Low-confidence results are flagged for review.
3. **Analyze.** Home, Budget, Transactions, and Credit Card views show cash flow, category breakdowns, trends, averages, and budget pace.
4. **Correct.** User corrections feed back into merchant memory and future AI prompts, so categorization improves with use.

## Priorities

In order:

1. **Correct numbers.** The analysis is the product. Never double count (see "Money semantics" below), never silently drop rows, and keep income, expenses, and transfers distinct.
2. **Beautiful, comfortable UI.** Do not ship anything that looks rough.
3. **Privacy and security.** All data stays local. Credentials and API keys are encrypted at rest and never logged. Personal transaction files are never committed.
4. **Open-source friendly.** Users can clone, run, and customize without code edits.
5. **Extensibility.** New import templates, banks, and AI providers should be easy to add.

## Sensitive financial data

This repository is public on GitHub, and the working copy sits next to the maintainer's real household finances: bank and card exports in `/transactions/`, and the live database, backups, and debug reports in `/data/`. Both folders are gitignored, but anything copied out of them into a tracked file is published.

Treat all of these as sensitive: account numbers, card last-4 digits, transaction descriptions and merchant names, amounts, dates tied to a merchant, reference or transaction IDs, salary and employer details, export file names (they often embed card digits), and the names of household members.

- **Tests.** Build fixtures from synthetic rows (`scripts/import-workbook-test-helpers.mjs`, `scripts/docs-seed/fake-data.mjs`). Never copy a real row, amount, account number, or file name into a test, not even as an example. New tests must not read from `/transactions/` or `/data/`: they fail for every other contributor and they invite pasting real values into assertions.
- **Plans, specs, and docs** (`docs/`, READMEs, PR descriptions, commit messages, issues). Describe the shape of the data (column headers, formats, edge cases), not its contents. When a real row is the clearest way to explain a bug, rewrite it with invented values that keep the same structure.
- **Screenshots.** Capture only from a workspace seeded with fake data, never from the live database.
- **Logs and debug output.** Never paste real rows into anything that gets committed, shared, or published as an artifact.
- **Before every commit,** read the diff and look for anything that came from a real export. If real data is already in a commit, stop and tell the user. Removing it needs a history rewrite and force push, which only the user can approve.
- **Commit hooks.** `npm run hooks:install` enables `.githooks/`, which runs `scripts/check-sensitive-data.mjs` on every commit. It fingerprints `/transactions/` and the databases in `/data/`, blocks staged lines and commit messages that contain those values, and prints matches masked. `npm run security:sensitive-data` scans the whole tree. Never bypass a block with `SPENT_ALLOW_SENSITIVE=1` or `--no-verify` unless the user confirms it is a false positive.

Import tests build every provider's export from synthetic builders in `scripts/import-workbook-test-helpers.mjs` (`PROVIDER_FIXTURES`). They mirror each real layout with invented values. When a new export variant appears, add a builder there instead of pointing a test at a real file.

## Money semantics

These rules decide whether the analysis is right. Read them before touching imports, kinds, categories, or summaries.

- Every transaction has a `kind`: `expense`, `income`, or `transfer` (`src/server/lib/transfers.ts` `detectKind`).
- **Credit card bill payments in a bank account are `transfer`, not `expense`.** The individual card purchases are already imported from the card file. Counting the bank debit too would double count. Detection uses Hebrew and English card-company patterns (`CREDIT_CARD_PAYMENT_PATTERNS`).
- Positive amounts in a bank account are `income`. Card rows are `expense`.
- Home cash flow (income vs. expenses) and category breakdowns both use all sources (bank plus cards). See `HOME_CASH_FLOW_SOURCE_TYPE` and `HOME_CATEGORY_SOURCE_TYPE` in `src/server/lib/home-analytics.ts`.
- A `Transfers` category exists for both expense and income. Summaries net it using signed amounts, so outgoing transfers reduce the total.
- Only `completed` transactions count in summaries. `pending` rows are shown but excluded.
- Averages and statistics use completed months only (`getLastCompleteMonthEnd`), so a half-finished month does not skew them.

### Savings

Spent does not track investments themselves (balances, returns, portfolios).

- **Savings = income minus expenses** for a period.
- Expenses must include all household spending: bank expenses plus card purchases. Card bill payments in the bank stay `transfer` so card spending is counted once, from the card files.

**Known issue:** the suggested monthly target in budget suggestions (`getMonthlyBankSpend` in `src/server/db/queries/transactions.ts`) still averages bank expenses only, so it omits card spending and suggests a target that is too low.

### Hidden transactions (unused)

`transactions.is_excluded`, the `excluded_merchants` table, and the helpers in `src/server/db/queries/excluded-merchants.ts` come from an unfinished "mark as irrelevant" feature. It was meant to hide the bank's monthly card-bill line, which is now handled by `kind = 'transfer'` detection instead. No UI uses it, imports never apply the rules, and no summary filters on it, so nothing is actually hidden. Do not build on it without asking the user first.

## Stack

- **Next.js 16** with App Router. Server components by default. Client components only where state or interactivity is needed.
- **TypeScript strict mode.** No `any` unless justified with a comment. A few import modules are plain JS with `.d.ts` files (`src/lib/imports/*.js`) so `node --test` can run them directly.
- **shadcn/ui v4 + base-ui.** Uses `base-ui`, not Radix. The `asChild` prop does not exist; use the `render` prop or style the primitive directly. Select `onValueChange` returns `string | null`, not `string`.
- **Tailwind CSS v4.** Uses the `@theme` directive in `globals.css`, not `tailwind.config.js`.
- **better-sqlite3** (WAL mode). It and `israeli-bank-scrapers` must stay in `serverExternalPackages` in `next.config.ts` because native bindings cannot be bundled.
- **TanStack Query** for client data fetching, **Recharts** for charts, **framer-motion** for animation.
- **next-intl** with English (default) and Hebrew (RTL). Locale comes from the `NEXT_LOCALE` cookie. Messages live in `src/i18n/messages/{en,he}.json`. Add every new user-facing string to both files.
- **AI providers:** Claude (`@anthropic-ai/sdk`) or local Ollama, or none.

## Conventions

- No em dashes anywhere in code, comments, docs, or commit messages.
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`.
- Comments only where the why is not obvious.
- Add `import "server-only"` at the top of every file in `src/server/`.
- Every user-data table is scoped by `workspace_id`. Every query must filter by workspace.
- Schema changes go in a new numbered file in `src/server/db/migrations/`. Never edit an applied migration. Migrations run automatically on startup (`src/server/db/migrate.ts`).

## Agent workflow

- Agents may create Git commits without asking first. Commit only working, verified changes (lint and relevant tests pass), keep each commit scoped to one logical change, and never commit files under `/transactions/` or `/data/`.
- Write a clear conventional commit subject and a body that explains what changed and why.
- Do not push, force push, rewrite history, or amend existing commits unless the user explicitly asks.
- Inspect the exact file, function, command, or error the user names before generalizing.
- Prefer direct edits and runnable verification over conceptual advice.
- Preserve existing schema and user-facing terminology unless the user explicitly asks for a rename.
- Use the repo's existing patterns first. Keep changes scoped and avoid unrelated refactors.
- Before changing Next.js code, read the relevant guide in `node_modules/next/dist/docs/`.
- After frontend changes, run the app and check the relevant screen in the browser when feasible, in both English and Hebrew if layout is affected.
- **Never commit, paste, or log real financial data.** Follow "Sensitive financial data" above in code, tests, plans, specs, docs, and commit messages.

## Architecture

### Data sources

Setup asks the user to choose a data source mode (`DataSourceMode` in `src/lib/types.ts`):

- **`xlsx` (primary).** File imports. This is the main way the app is used.
- **`scraper` (secondary).** Automated sync through `israeli-bank-scrapers` (Puppeteer) using encrypted bank credentials. Gated by `ENABLE_SCRAPER_SYNC` in `src/lib/features.ts`. It can violate bank Terms of Service, so it stays opt-in.

### Supported import templates

Defined in `src/lib/imports/templates.js` and auto-detected by Hebrew header signatures in `src/lib/imports/template-detector.js`:

| Template | Kind | Institution |
| --- | --- | --- |
| `max_bill` | card | Max |
| `isracard_bill` | card | Isracard |
| `cal_bill` | card | CAL |
| `hapoalim_bank_account` | bank | Bank Hapoalim |
| `leumi_bank_account` | bank | Bank Leumi (HTML-based `.xls`) |

Upload limits: 20 files, 15 MB per file, 50 MB total (`src/server/imports/import-upload-limits.ts`).

### Import flow

1. `POST /api/imports/preview`: detects the template per file, parses rows, computes dedup hashes, marks duplicates against the database and within the batch. Returns per-file previews with row issues and file issues (`unsupported`, `ambiguous`, `unreadable`).
2. The user reviews the preview (`src/components/imports/import-preview-panel.tsx`).
3. `POST /api/imports/commit`: inserts rows with count-based dedup (one `sync_runs` row per file), then runs categorization.

### Categorization pipeline

`categorizeWorkspaceTransactions` in `src/server/sync/categorization.ts`, run separately for `expense` and `income`:

1. **Merchant memory** (`src/server/lib/merchant-memory.ts`): exact normalized-merchant matches from user corrections and approved AI results.
2. **History majority vote** (`src/server/sync/description-history.ts`): if the normalized description has at least `HISTORY_DATABASE_THRESHOLD` (5) categorized past transactions and a clear winner, use it. Ties or thin history go to AI.
3. **AI** (`src/server/ai/`): remaining rows in batches of 50. The prompt includes category descriptions, recent user corrections, and matching history. Results carry `ai_confidence`; low confidence sets `needs_review`.

`npm run debug:import-classification` prints the routing decision per transaction.

### Categories

- Seeded, per workspace, with descriptions that guide the AI.
- Two-level hierarchy for expenses: parent groups (Food, Transportation, Lifestyle, Home & Bills, Health & Family, Money Movement) with seeded leaves. Income categories are flat.
- Users can add, edit, and delete categories. Each category has a `budget_mode` of `budgeted` or `tracking`.

### Workspaces

A workspace is a data scope, not an account. One local user can keep separate workspaces (for example Home and Business). All transactions, categories, budgets, merchant memory, and bank credentials are partitioned by `workspace_id`. AI provider settings are global.

### Setup wizard

`/setup`, flow defined in `src/lib/setup/wizard-flow.ts`. For `xlsx` mode: Source, AI, Import, Stats, Target, Budgets, Done. For `scraper` mode: Source, Connect, AI, Target, Budgets, Done. New workspaces add a Name step first.

### Pages

- `/`: Home, scoped to `?month=YYYY-MM` (defaults to the current month). KPI tiles (income, expenses, net, savings rate with deltas and 6-month averages), 12-month cash-flow chart, where money went, budget pace, averages (selectable month range), needs attention, recent transactions.
- `/budget`: monthly budgets per category with pace tracking.
- `/transactions`: full table with filters, sorting, KPIs, and inline recategorization.
- `/credit-card`: card-only spending view.
- `/settings/*`: general, data (import), bank, AI, categories (plus statistics review), appearance.

### Key files

- `src/lib/types.ts`: shared types, `BANK_PROVIDERS`, `ImportTemplateType`, `DataSourceMode`.
- `src/lib/imports/`: template definitions, detection, XLSX parsing, batch staging (shared by client and server).
- `src/server/imports/`: preview orchestration, commit, upload limits.
- `src/server/sync/categorization.ts`: the categorization pipeline.
- `src/server/sync/orchestrator.ts`: scraper sync orchestration.
- `src/server/lib/transfers.ts`: transaction kind detection.
- `src/server/lib/home-analytics.ts`, `src/server/db/queries/home.ts`: home page analytics.
- `src/server/lib/transaction-summary.ts`, `summary-categories.ts`: summary math.
- `src/server/lib/budget-suggestions.ts`, `pace.ts`: budget suggestions and pace.
- `src/server/lib/dedup.ts`: SHA-256 hash of stable transaction fields.
- `src/server/lib/encryption.ts`: AES-256-GCM helpers; generates the key file on first use.
- `src/server/db/index.ts`: SQLite singleton (globalThis pattern for HMR safety, WAL mode).
- `src/server/db/queries/transactions.ts`: dedup-on-insert and transaction queries.
- `src/server/ai/factory.ts`: returns `ClaudeProvider`, `OllamaProvider`, or null.
- `src/server/ai/prompts.ts`: categorization prompt shared by Claude and Ollama.

### Adding a new import template

1. Add the type to `ImportTemplateType` in `src/lib/types.ts`.
2. Add a definition to `IMPORT_TEMPLATE_DEFINITIONS` in `src/lib/imports/templates.js`.
3. Add a header signature to `IMPORT_SIGNATURES` in `src/lib/imports/template-detector.js`. Make sure it does not collide with existing signatures (ambiguous matches are rejected).
4. Add a parser branch in `src/lib/imports/xlsx-parser.js`.
5. Register the provider in `src/lib/transaction-source-types.ts` (card or bank). For bank templates, also add it to `BANK_PROVIDERS_SET` in `src/server/lib/transfers.ts` so income and card-payment detection work.
6. Add tests in `scripts/test-import-*.mjs` using synthetic rows, then run `npm run test:imports`.

### Adding a new scraper bank

1. Add it to `BANK_PROVIDERS` in `src/lib/types.ts` with its credential field schema.
2. Map it to the `CompanyTypes` enum in `PROVIDER_MAP` in `src/server/scrapers/index.ts`.
3. Register it in `src/lib/transaction-source-types.ts` and, for banks, `src/server/lib/transfers.ts`.
4. Set `enabled: true`.

### Adding a new AI provider

1. Implement the `AIProvider` interface from `src/server/ai/types.ts`.
2. Add it to `createAIProvider()` in `src/server/ai/factory.ts`.
3. Add the option to `src/components/setup/ai-step.tsx` and `src/components/settings/ai-section.tsx`.
4. Handle its settings keys in `src/app/api/setup/ai/route.ts`.

## Running and testing

```bash
npm run dev              # dev server on 127.0.0.1:3000
npm run lint
npm run test:imports     # template detection, parsers, preview orchestration
npm run test:logic       # categorization, review filter, analytics, setup logic
```

Tests are plain `node --test` scripts in `scripts/`. `scripts/test-*` is gitignored by default except the tracked ones, so local scratch tests stay out of the repo.

To test imports end to end, use the Import button on the Home page (`src/components/dashboard/import-xlsx-button.tsx`) with export files from a supported institution.

To reset local state, delete `data/spent.db*` and `data/.encryption-key`.

## Known quirks

- Israeli exports are Hebrew, often with RTL marks and merged header rows. Detection strips `‎` / `‏` and normalizes whitespace before matching.
- The Leumi "xls" export is actually HTML, not a real workbook.
- Card bills include installment purchases (`type: installments`) and foreign currency rows where `originalAmount` and `chargedAmount` differ.
- **Known issue: later installments can dedupe away.** An installment purchase repeats in every monthly card file with the same purchase date, merchant and original amount. The payment number ("N of M") only appears in a notes column, and no parser sets `installmentNumber` / `installmentTotal` yet, so payments 2 to M hash the same as payment 1 and are skipped as duplicates. Fixing it needs the real notes format per export, and care so statement rows still dedupe against already stored rows.
- `identifier` is not reliably unique across institutions. Dedup uses a composite hash plus a per-hash count, so importing the same file twice is safe and genuine identical purchases on the same day are kept.
- `israeli-bank-scrapers` runs Puppeteer with a hardcoded Asia/Jerusalem timezone. Most banks except OneZero do not support 2FA. Some (Yahav) only return 6 months of history.
- `claude-haiku-4-5-20251001` is the default Claude model for categorization. Change it in `src/server/ai/providers/claude.ts`.

## Out of scope for now

- Transaction exports (CSV, OFX).
- Multi-user support and auth.
- Hosted or cloud deployment.
- Mobile app (Phase 2).

## History

The original design spec (`~/.claude/plans/personal-finance-tracker-cozy-reef.md`) described a scraper-first app. The project has since moved to file imports as the primary data source, with workspaces, budgets, Hebrew UI, and editable categories added along the way. Trust the code and this file over the original spec.
