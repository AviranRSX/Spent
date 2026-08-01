# History Majority Categorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Categorize repeated descriptions from database history at five prior matches, send deduplicated category-count history to AI for lower-count or tied cases, and generate an auditable report from an isolated `personal-dev` database copy.

**Architecture:** Add a grouped transaction-history query and a pure decision module, then route memory hits, history-vote wins, and AI-bound transactions in the existing categorization service. Extend AI provider options with matching history and an opt-in prompt observer. A local diagnostic runner creates a SQLite backup, imports every workbook through the production pipeline, captures structured decisions and exact prompts, and writes Markdown and JSON reports.

**Tech Stack:** TypeScript strict mode, Node test runner, better-sqlite3, existing XLS/XLSX parser, Claude and Ollama provider adapters.

## Global Constraints

- Work only on branch `feat/history-majority-categorization`.
- Do not create a Git commit unless the user explicitly requests one.
- Do not use em dashes in code, comments, documentation, or commit messages.
- Add `import "server-only"` to every new file under `src/server/`.
- Use the existing `normalizeMerchant` behavior for description matching.
- Database classification starts at exactly 5 prior categorized matches.
- Any top-count tie routes to AI with history.
- Deduplicate prompt history by normalized description and omit transaction numbers from that history section.
- Keep transaction numbers in the `Transactions` section for response mapping.
- Keep debug capture disabled unless an explicit diagnostic sink is provided.
- Never modify `data/spent.db` during the personal-dev diagnostic run.

---

### Task 1: Build and test historical evidence and voting

**Files:**
- Create: `src/server/sync/description-history.ts`
- Modify: `src/server/db/queries/transactions.ts`
- Modify: `scripts/test-transaction-ai-logic.mjs`

**Interfaces:**
- Produces `getCategorizedDescriptionCounts(workspaceId, kind): CategorizedDescriptionCountRow[]`.
- Produces `buildDescriptionHistory(rows): Map<string, DescriptionCategoryHistory>`.
- Produces `decideDescriptionHistory(history): DescriptionHistoryDecision`.
- Uses the existing `normalizeMerchant(description)` function.

- [ ] **Step 1: Add failing tests for normalization aggregation and decision boundaries**

Add tests to `scripts/test-transaction-ai-logic.mjs` that dynamically import the new module and assert:

```js
test("combines category counts across normalized description variants", async () => {
  const { buildDescriptionHistory } = await import(
    "../src/server/sync/description-history.ts"
  );
  const history = buildDescriptionHistory([
    { description: " AM:PM  ", categoryId: 10, categoryName: "Groceries", count: 2 },
    { description: "am:pm 123", categoryId: 10, categoryName: "Groceries", count: 1 },
    { description: "am:pm", categoryId: 11, categoryName: "Restaurants", count: 1 },
  ]).get("am:pm");

  assert.deepEqual(history, {
    normalizedDescription: "am:pm",
    total: 4,
    categories: [
      { categoryId: 10, categoryName: "Groceries", count: 3 },
      { categoryId: 11, categoryName: "Restaurants", count: 1 },
    ],
  });
});

test("uses a unique history winner at exactly five matches", async () => {
  const { decideDescriptionHistory } = await import(
    "../src/server/sync/description-history.ts"
  );
  assert.deepEqual(
    decideDescriptionHistory({
      normalizedDescription: "am:pm",
      total: 5,
      categories: [
        { categoryId: 10, categoryName: "Groceries", count: 3 },
        { categoryId: 11, categoryName: "Restaurants", count: 2 },
      ],
    }),
    { route: "database", reason: "majority-vote", categoryId: 10, categoryName: "Groceries" }
  );
});

test("routes four matches and top-count ties to AI", async () => {
  const { decideDescriptionHistory } = await import(
    "../src/server/sync/description-history.ts"
  );
  assert.equal(decideDescriptionHistory({ normalizedDescription: "x", total: 4, categories: [] }).reason, "below-threshold");
  assert.equal(
    decideDescriptionHistory({
      normalizedDescription: "x",
      total: 6,
      categories: [
        { categoryId: 1, categoryName: "A", count: 3 },
        { categoryId: 2, categoryName: "B", count: 3 },
      ],
    }).reason,
    "tied-vote"
  );
});

test("routes an unseen description to AI as no history", async () => {
  const { decideDescriptionHistory } = await import(
    "../src/server/sync/description-history.ts"
  );
  assert.deepEqual(decideDescriptionHistory(null), {
    route: "ai",
    reason: "no-history",
    categoryId: null,
    categoryName: null,
  });
});
```

Also add a temporary-database test that creates two workspaces, expense and income categories, categorized and uncategorized transactions, calls `getCategorizedDescriptionCounts`, and asserts that the result contains only categorized rows from the requested workspace and kind. Change one stored category and call the query again to prove corrections affect the next result immediately.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm run test:logic`

Expected: FAIL because `src/server/sync/description-history.ts` does not exist.

- [ ] **Step 3: Implement the grouped database query**

Add to `transactions.ts`:

```ts
export interface CategorizedDescriptionCountRow {
  description: string;
  categoryId: number;
  categoryName: string;
  count: number;
}

export function getCategorizedDescriptionCounts(
  workspaceId: number,
  kind: "expense" | "income"
): CategorizedDescriptionCountRow[] {
  return getDb().prepare(`
    SELECT t.description,
           c.id AS categoryId,
           c.name AS categoryName,
           COUNT(*) AS count
    FROM transactions t
    JOIN categories c
      ON c.id = t.category_id
     AND c.workspace_id = t.workspace_id
     AND c.kind = t.kind
    WHERE t.workspace_id = ?
      AND t.kind = ?
      AND t.category_id IS NOT NULL
    GROUP BY t.description, c.id, c.name
  `).all(workspaceId, kind) as CategorizedDescriptionCountRow[];
}
```

The workspace and kind predicates provide isolation, and the inner join excludes deleted or invalid categories.

- [ ] **Step 4: Implement pure aggregation and voting**

Create `description-history.ts` with these exported types and rules:

```ts
import "server-only";

import type { CategorizedDescriptionCountRow } from "@/server/db/queries/transactions";
import { normalizeMerchant } from "@/server/lib/merchant-memory";

export const HISTORY_DATABASE_THRESHOLD = 5;

export interface DescriptionCategoryHistory {
  normalizedDescription: string;
  total: number;
  categories: Array<{ categoryId: number; categoryName: string; count: number }>;
}

export type DescriptionHistoryDecision =
  | { route: "database"; reason: "majority-vote"; categoryId: number; categoryName: string }
  | { route: "ai"; reason: "no-history" | "below-threshold" | "tied-vote"; categoryId: null; categoryName: null };
```

Aggregate identical normalized keys and category IDs, sort categories by descending count then `categoryName.localeCompare`, calculate totals, return `no-history` for null or zero history, `below-threshold` below 5, `tied-vote` when the first two counts match, and otherwise return the first category as `majority-vote`.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npm run test:logic`

Expected: all logic tests pass.

- [ ] **Step 6: Review checkpoint without committing**

Run: `git diff -- src/server/sync/description-history.ts src/server/db/queries/transactions.ts scripts/test-transaction-ai-logic.mjs`

Confirm the query is scoped by workspace and kind and the threshold is exactly 5.

---

### Task 2: Add deduplicated matching history to AI prompts

**Files:**
- Modify: `src/server/ai/types.ts`
- Modify: `src/server/ai/prompts.ts`
- Modify: `src/server/ai/providers/claude.ts`
- Modify: `src/server/ai/providers/ollama.ts`
- Modify: `scripts/test-transaction-ai-logic.mjs`

**Interfaces:**
- Consumes `DescriptionCategoryHistory` from Task 1.
- Extends `AIProvider.categorize` options with `matchingHistory` and `onPrompt`.
- Produces exact prompt observation before each provider request.

- [ ] **Step 1: Add failing prompt and provider-observer tests**

Add a prompt test with two duplicate normalized descriptions:

```js
test("renders matching history once per normalized description without transaction numbers", async () => {
  const { buildCategorizationPrompt } = await import("../src/server/ai/prompts.ts");
  const prompt = buildCategorizationPrompt(
    [
      { description: "AM:PM", amount: -84.2, currency: "ILS" },
      { description: "am:pm 123", amount: -42.1, currency: "ILS" },
    ],
    [{ name: "Groceries", description: "Food stores" }],
    false,
    [],
    [
      {
        normalizedDescription: "am:pm",
        displayDescription: "AM:PM",
        total: 4,
        categories: [{ categoryName: "Groceries", count: 4 }],
      },
      {
        normalizedDescription: "am:pm",
        displayDescription: "am:pm 123",
        total: 4,
        categories: [{ categoryName: "Groceries", count: 4 }],
      },
    ]
  );

  assert.equal((prompt.match(/Matching description history:/g) ?? []).length, 1);
  assert.equal((prompt.match(/Groceries: 4\. Total: 4\./g) ?? []).length, 1);
  assert.doesNotMatch(prompt, /Transaction 0, "AM:PM"/);
  assert.match(prompt, /0: "AM:PM" \| ILS 84\.20/);
  assert.match(prompt, /1: "am:pm 123" \| ILS 42\.10/);
});
```

Extend the existing Ollama provider test to supply `onPrompt`, then assert the observed system and user prompts exactly equal the request messages.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm run test:logic`

Expected: FAIL because prompt history and `onPrompt` are not supported.

- [ ] **Step 3: Extend the AI types**

Add these types to `src/server/ai/types.ts`:

```ts
export interface MatchingDescriptionHistory {
  normalizedDescription: string;
  displayDescription: string;
  total: number;
  categories: Array<{ categoryName: string; count: number }>;
}

export interface CategorizationPromptObservation {
  systemPrompt: string;
  userPrompt: string;
}

export interface CategorizationOptions {
  allowProposals?: boolean;
  pastCorrections?: PastCorrection[];
  matchingHistory?: MatchingDescriptionHistory[];
  onPrompt?: (observation: CategorizationPromptObservation) => void;
}
```

Change `AIProvider.categorize` to accept `options?: CategorizationOptions`.

- [ ] **Step 4: Render unique unnumbered history**

Extend `buildCategorizationPrompt` with a fifth `matchingHistory` argument. Add a renderer that keeps the first item for each `normalizedDescription`, emits no section for an empty list, and formats each item as:

```text
- "AM:PM": Groceries: 3, Restaurants: 1. Total: 4.
```

Insert the section after past corrections and before `Transactions`. Add the two approved history rules to both standard and proposal prompt variants.

- [ ] **Step 5: Observe exact prompts in both providers**

In Claude and Ollama providers, build the prompt with `options?.matchingHistory ?? []`, invoke:

```ts
options?.onPrompt?.({ systemPrompt: SYSTEM_PROMPT, userPrompt: prompt });
```

immediately before the network request, then send those same strings without modification.

- [ ] **Step 6: Run tests and verify GREEN**

Run: `npm run test:logic`

Expected: all logic tests pass, including the exact Ollama request observation.

- [ ] **Step 7: Review checkpoint without committing**

Run: `git diff -- src/server/ai scripts/test-transaction-ai-logic.mjs`

Confirm history lines are unique and unnumbered while transaction indices remain unchanged.

---

### Task 3: Integrate memory, database votes, AI routing, and diagnostics

**Files:**
- Modify: `src/server/sync/categorization.ts`
- Modify: `scripts/test-transaction-ai-logic.mjs`

**Interfaces:**
- Consumes grouped history and decisions from Task 1.
- Consumes matching prompt history and prompt observation from Task 2.
- Extends `categorizeWorkspaceTransactions` with optional diagnostics while preserving existing callers.

- [ ] **Step 1: Add failing route-planning tests**

Export a pure `planDescriptionHistoryRoutes` helper from `description-history.ts` and test a mixed batch containing:

```js
const transactions = [
  { id: 1, description: "Known Memory" },
  { id: 2, description: "Five Wins" },
  { id: 3, description: "Four Needs AI" },
  { id: 4, description: "Tie Needs AI" },
  { id: 5, description: "four needs ai 99" },
];
```

Assert that memory ID 1 stays first priority, ID 2 receives the database winner, IDs 3 through 5 route to AI, and IDs 3 and 5 produce one shared matching-history entry.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm run test:logic`

Expected: FAIL because mixed route planning does not exist.

- [ ] **Step 3: Define diagnostic event types**

In `categorization.ts`, export:

```ts
export type CategorizationDecisionReason =
  | "memory-hit"
  | "majority-vote"
  | "below-threshold"
  | "tied-vote"
  | "no-history";

export type CategorizationDiagnosticEvent =
  | { type: "decision"; transactionId: number; description: string; normalizedDescription: string; kind: "expense" | "income"; historicalMatchCount: number; history: Array<{ category: string; count: number }>; route: "memory" | "database" | "ai"; reason: CategorizationDecisionReason; selectedCategory: string | null }
  | { type: "ai-batch"; kind: "expense" | "income"; transactionIds: number[]; systemPrompt: string; userPrompt: string; mappings: Array<{ index: number; categoryName: string; confidence?: number }>; updates: Array<{ id: number; categoryId: number; aiConfidence: number | null; needsReview: boolean }>; error: string | null };

export type CategorizationDiagnosticSink = (event: CategorizationDiagnosticEvent) => void;
```

Add a fourth optional argument to `categorizeWorkspaceTransactions` named `diagnosticSink`. Existing two- and three-argument call sites remain valid.

- [ ] **Step 4: Reorder categorization so local decisions do not require AI**

For each kind:

1. Load categories and uncategorized transactions.
2. Apply valid explicit merchant-memory hits.
3. Load and aggregate categorized description history.
4. Apply unique winners with at least 5 matches using `batchUpdateCategories`.
5. Emit one decision event for every transaction.
6. Build the remaining AI batches.
7. Create the AI provider only if at least one AI-bound transaction exists.
8. Start or check Ollama only if AI work exists.

Cache provider creation and Ollama readiness across both kinds. If AI is unavailable, retain local updates and return the existing friendly warning for only the remaining AI rows.

- [ ] **Step 5: Pass unique batch history and capture exact AI diagnostics**

For each final AI batch, build `matchingHistory` from only that batch's normalized descriptions. Use `onPrompt` to retain the exact system and user strings. After mappings are validated against categories and converted into updates, emit one `ai-batch` event with transaction IDs, prompts, mappings, final category IDs, confidence, review flags, and any error.

- [ ] **Step 6: Run tests and verify GREEN**

Run: `npm run test:logic`

Expected: all logic tests pass.

- [ ] **Step 7: Run TypeScript validation**

Run: `npx tsc --noEmit`

Expected: exit 0 with existing call sites unchanged.

- [ ] **Step 8: Review checkpoint without committing**

Run: `git diff -- src/server/sync/categorization.ts src/server/sync/description-history.ts src/server/ai`

Confirm database routes cannot call a provider and diagnostics are opt-in.

---

### Task 4: Build the isolated personal-dev diagnostic runner

**Files:**
- Create: `scripts/debug-import-classification.mjs`
- Modify: `package.json`
- Modify: `scripts/test-transaction-ai-logic.mjs`

**Interfaces:**
- Runs as `npm run debug:import-classification`.
- Creates `data/personal-dev/spent.db` with SQLite backup.
- Produces `data/personal-dev/classification-report.json` and `.md`.

- [ ] **Step 1: Add failing tests for report shaping**

Keep report formatting in exported pure functions from the runner and add tests that assert:

```js
test("classification report focuses five-plus rows and preserves exact prompts", async () => {
  const { buildClassificationReport } = await import(
    "../scripts/debug-import-classification.mjs"
  );
  const report = buildClassificationReport({
    files: [],
    importedTransactionIds: [7, 8],
    events: [
      { type: "decision", transactionId: 7, description: "A", normalizedDescription: "a", kind: "expense", historicalMatchCount: 5, history: [{ category: "Groceries", count: 5 }], route: "database", reason: "majority-vote", selectedCategory: "Groceries" },
      { type: "ai-batch", kind: "expense", transactionIds: [8], systemPrompt: "system", userPrompt: "exact prompt", mappings: [], updates: [], error: null },
    ],
  });
  assert.equal(report.fivePlusRows.length, 1);
  assert.equal(report.aiBatches[0].userPrompt, "exact prompt");
});
```

Guard execution with an `isMain` check so importing the runner in tests does not copy or mutate a database.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm run test:logic`

Expected: FAIL because the runner does not exist.

- [ ] **Step 3: Implement safe database backup and target validation**

Resolve these exact default paths from the repository root:

```js
const sourceDbPath = path.resolve("data", "spent.db");
const targetDataDir = path.resolve("data", "personal-dev");
const targetDbPath = path.join(targetDataDir, "spent.db");
```

Before writes, assert `targetDataDir === path.resolve("data", "personal-dev")`, create the directory, remove only prior report files and the exact target database sidecars, and call `await sourceDb.backup(targetDbPath)`. Never copy `spent.db` without its WAL through a plain file copy.

Set `process.env.SPENT_DATA_DIR = targetDataDir` before dynamically importing any `src/server` module. Rename the copied workspace whose name equals `Personal` case-insensitively to `personal-dev` using `updateWorkspace`.

- [ ] **Step 4: Load every transaction workbook through production components**

Read regular files in `transactions/` in deterministic filename order. For each file, use `detectWorkbookBuffer`, `parseWorkbookBuffer`, `getImportTemplateLabel`, `previewImportRows`, and `previewImportWorkbooks`. Record unsupported, ambiguous, unreadable, and row-level issues. Pass supported previews to `commitImportFiles` with `{ categorize: false }`.

Capture transaction IDs in the target workspace before and after commit and calculate the new-ID set. Then call `categorizeWorkspaceTransactions` with the diagnostic sink.

- [ ] **Step 5: Generate JSON and Markdown reports**

`buildClassificationReport` returns:

```js
{
  generatedAt,
  sourceDatabase,
  targetDatabase,
  workspace,
  files,
  importTotals,
  newRowDecisions,
  fivePlusRows,
  aiBatches,
  aiWarning,
}
```

The Markdown report includes tables for file results, all new rows, and five-plus rows, followed by fenced text blocks containing each exact system prompt, user prompt, mappings, and final updates. Escape table pipes and do not truncate descriptions or prompts.

- [ ] **Step 6: Add the package command**

Add:

```json
"debug:import-classification": "node --conditions react-server --experimental-transform-types scripts/debug-import-classification.mjs"
```

The runner registers a Node resolution hook for extensionless relative TypeScript imports and `@/` aliases before dynamically importing server modules.

- [ ] **Step 7: Run tests and verify GREEN**

Run: `npm run test:logic`

Expected: all tests pass without creating `data/personal-dev` merely from importing the runner.

- [ ] **Step 8: Review checkpoint without committing**

Run: `git diff -- scripts/debug-import-classification.mjs package.json scripts/test-transaction-ai-logic.mjs`

Confirm destructive operations target only the exact ignored `data/personal-dev` directory.

---

### Task 5: Run the personal-dev import and complete verification

**Files:**
- Generated locally: `data/personal-dev/spent.db`
- Generated locally: `data/personal-dev/classification-report.json`
- Generated locally: `data/personal-dev/classification-report.md`
- Review all modified source and test files.

**Interfaces:**
- Consumes the diagnostic command from Task 4.
- Produces the user-requested database copy and report.

- [ ] **Step 1: Record original database integrity evidence**

Run a read-only query against `data/spent.db` to record its file size, workspace transaction counts, and `PRAGMA quick_check`. Do not expose encrypted settings or credentials.

- [ ] **Step 2: Execute the isolated diagnostic import**

Run: `npm run debug:import-classification`

Expected: exit 0, target workspace named `personal-dev`, all transaction-folder files represented in the report, supported rows imported through deduplication, and AI-bound prompts captured before Ollama calls.

- [ ] **Step 3: Validate the generated report**

Check programmatically that:

```text
- every new imported uncategorized row has one decision event
- every database route has at least 5 matches and no top tie
- every below-threshold or tied route is AI-bound
- each normalized description appears at most once per AI prompt history section
- matching-history lines contain no transaction numbers
- all AI batches include exact non-empty system and user prompts
```

- [ ] **Step 4: Prove the original database was untouched**

Repeat the read-only source database counts and `PRAGMA quick_check`. Compare them to Step 1. WAL file size changes caused by another running app are not sufficient evidence of data changes; compare logical workspace and transaction counts.

- [ ] **Step 5: Run the full automated verification suite**

Run:

```text
npm run test:logic
npm run test:imports
npx tsc --noEmit
npm run lint
```

Expected: all commands exit 0 with no new warnings attributable to this feature.

- [ ] **Step 6: Inspect final repository state**

Run:

```text
git status --short --branch
git diff --check
git diff --stat
```

Expected: branch is `feat/history-majority-categorization`, only scoped source, test, package, spec, and plan changes appear, generated `data/personal-dev` files remain ignored, and there are no whitespace errors.

- [ ] **Step 7: Report results without committing**

Provide links to both generated reports and summarize rows with at least 5 matches, their histories, selected categories, route decisions, AI prompt count, unsupported files, tests, TypeScript, lint, and source-database integrity comparison. Do not create a commit unless explicitly asked.
