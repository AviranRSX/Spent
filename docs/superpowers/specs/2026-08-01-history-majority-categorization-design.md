# History Majority Categorization Design

## Goal

Reduce AI categorization calls during imports by using existing categorized transaction history for repeated normalized descriptions. Supply the same history to the AI when local evidence is insufficient or tied, and produce an opt-in diagnostic report from an isolated copy of the personal database.

## Scope

This feature applies to uncategorized expense and income transactions processed by the existing workspace categorization flow, including workbook imports and bank syncs. It uses the transaction `description` as the merchant label and the existing `normalizeMerchant` behavior, which trims and lowercases text, collapses repeated whitespace, and removes trailing numbers.

Transfers remain outside the existing AI categorization flow. Existing merchant memory based on explicit user or approved-AI mappings remains intact and retains priority over history voting.

## Historical Evidence

At the start of each expense or income categorization pass, query categorized transactions in the same workspace and kind. Group them by stored description and category in SQL, then normalize and combine the grouped descriptions in TypeScript.

Only transactions with a non-null category count as evidence. Uncategorized rows, rows from other workspaces, and rows of another kind do not count. Category counts are derived from transactions on every run, so later user corrections immediately affect future decisions without maintaining a second counter table.

Each new uncategorized transaction receives a history summary shaped like:

```ts
interface DescriptionCategoryHistory {
  normalizedDescription: string;
  total: number;
  categories: Array<{
    categoryId: number;
    categoryName: string;
    count: number;
  }>;
}
```

Categories are ordered by descending count, then by category name for deterministic output.

## Decision Rule

For every new uncategorized transaction:

1. Existing explicit merchant memory is checked first. A valid memory hit keeps the current behavior and does not enter history voting.
2. Look up categorized transaction history using the normalized description, workspace, and transaction kind.
3. If fewer than 5 historical matches exist, route the transaction to AI.
4. If at least 5 matches exist and one category has a unique highest count, assign that category locally.
5. If multiple categories tie for the highest count, route the transaction to AI regardless of the total match count.

The unique highest count is a plurality decision, not a requirement for more than 50 percent of the observations. For example, counts of `3, 2, 1` select the category with 3, while `3, 3, 1` route to AI.

History-vote assignments use the normal batch category update path and are not sent to an AI provider. They do not receive AI confidence. AI-routed assignments keep the current confidence and review behavior.

Memory and history decisions run before AI-provider creation and connectivity checks. Therefore, database-routed rows are still categorized when no AI provider is configured or Ollama is unavailable. Only the rows that actually require AI remain uncategorized and produce the existing friendly warning.

The history snapshot is taken once per transaction kind at the beginning of the pass. Newly categorized rows from the same pass do not become evidence until a later categorization run. This prevents decisions from depending on input ordering.

## AI Prompt

The prompt builder accepts optional matching-description history for AI-bound transactions. It deduplicates this section by normalized description, so duplicate transactions in the same AI batch produce one history line. The first transaction description for each normalized key is used as the display label. AI-bound descriptions with no history are omitted from this section.

Prompt structure:

```text
Categorize these financial transactions.

Categories (use ONLY these names):
<existing category list>

Past corrections:
<existing correction examples, when present>

Matching description history:
- "<description>": <Category A>: <count>, <Category B>: <count>. Total: <total>.

Transactions:
<existing indexed transaction list>

Return ONLY a valid JSON array...
<existing confidence scale and rules>
```

Example:

```text
Categorize these financial transactions.

Categories (use ONLY these names):
- Groceries - Supermarkets and food stores
- Restaurants - Restaurants, cafes, and takeout

Matching description history:
- "AM:PM": Groceries: 3, Restaurants: 1. Total: 4.
- "Coffee Shop": Restaurants: 2. Total: 2.

Transactions:
0: "AM:PM" | ILS 84.20
1: "Coffee Shop" | ILS 18.00

Return ONLY a valid JSON array. Each element MUST have "index" (number), "categoryName" (string from the list above), and "confidence" (integer 1-7).
```

The prompt adds these rules:

```text
- Matching-description history contains prior categorized transactions with the same normalized description.
- Treat this history as strong evidence, but resolve ambiguity using the transaction details and category definitions.
```

The matching-history section has no transaction indices. The numbered transaction list remains unchanged because the AI response uses those indices to map results back to rows. When a batch contains duplicate normalized descriptions, each transaction remains in the numbered transaction list, but their shared history appears only once.

## Diagnostics

Production categorization remains quiet by default. An optional diagnostic sink receives structured decision and AI-batch events only when explicitly supplied.

Each transaction decision includes:

```ts
interface CategorizationDecisionDiagnostic {
  transactionId: number;
  description: string;
  normalizedDescription: string;
  kind: "expense" | "income";
  historicalMatchCount: number;
  history: Array<{ category: string; count: number }>;
  route: "memory" | "database" | "ai";
  reason: "memory-hit" | "majority-vote" | "below-threshold" | "tied-vote" | "no-history";
  selectedCategory: string | null;
}
```

Each AI batch diagnostic includes the exact system prompt, exact user prompt, model response mappings, and resulting transaction updates. Sensitive prompts and descriptions are never logged unless diagnostics are explicitly enabled.

## Isolated Personal-Dev Run

Create `data/personal-dev/` and use SQLite's online backup mechanism to produce a WAL-consistent `data/personal-dev/spent.db` from `data/spent.db`. Run all subsequent operations with `SPENT_DATA_DIR` pointing to that directory. Rename the copied `Personal` workspace to `personal-dev`. The original database and its WAL files are never modified.

Load every file from `transactions/` through the real workbook detector, parser, preview, deduplication, insertion, and categorization components. Unsupported, ambiguous, or unreadable workbooks and row-level parser issues are recorded instead of silently discarded.

The copied database uses Ollama, so AI-routed transactions use the configured local model. Capture the exact prompt before each model call.

Write ignored local artifacts:

```text
data/personal-dev/classification-report.md
data/personal-dev/classification-report.json
```

The reports include file outcomes, added and duplicate counts, all new-row decisions, histories, routes, selected categories, AI prompts and mappings, final confidence and review state, and a focused summary of rows with at least 5 historical matches.

Newly inserted rows are identified by the sync-run IDs created for this diagnostic import. Existing uncategorized rows in the copied database may still be processed by the normal workspace categorizer, but the new-row report marks and summarizes only transactions inserted by this run.

## Error Handling

- A history query failure fails the categorization run rather than silently increasing AI usage.
- A history category that no longer exists is ignored and cannot win a vote.
- AI failures retain the existing friendly warning behavior and remain visible in the diagnostic report.
- Unsupported or unreadable workbooks do not prevent other files from being previewed and reported.
- The diagnostic runner verifies its resolved data directory is `data/personal-dev` before any import writes.

## Testing

Automated tests cover:

- Exactly 5 matches with a unique highest category routes to the database.
- More than 5 matches with a unique highest category routes to the database.
- Four matches route to AI and render category-count history.
- A highest-count tie routes to AI and renders category-count history.
- Case, repeated whitespace, and trailing-number variants share history.
- History is isolated by workspace and transaction kind.
- Uncategorized historical transactions do not count.
- Corrected transaction categories immediately affect the next vote.
- Memory hits retain priority over history voting.
- Duplicate normalized descriptions produce one unnumbered matching-history line while all transactions retain their response-mapping indices.
- AI prompt indices remain correct after locally categorized rows are removed.
- Diagnostic capture is disabled by default.
- Diagnostic events contain the complete decision evidence and exact AI prompt when enabled.

Verification includes the focused logic tests, import tests, TypeScript compilation, lint, and the isolated `personal-dev` folder import and report generation.

## Git Behavior

All work occurs on branch `feat/history-majority-categorization`. No commit is created unless the user explicitly requests one.
