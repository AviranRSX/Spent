import assert from "node:assert/strict";
import path from "node:path";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
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

const transfers = await import("../src/server/lib/transfers.ts");
const sourceTypes = await import("../src/lib/transaction-source-types.ts");

test("classifies bank account import credits as income", () => {
  assert.equal(
    transfers.detectKind("משכורת · המבצע: דיסקונט", "hapoalim_bank_account", 12697),
    "income"
  );
  assert.equal(
    transfers.detectKind("העברת משכורת", "leumi_bank_account", 21403),
    "income"
  );
});

test("classifies bank account credit card settlements as transfers", () => {
  assert.equal(transfers.detectKind("כאל", "hapoalim_bank_account", -2365.38), "transfer");
  assert.equal(
    transfers.detectKind("ישראכרט בעמ · עבור: מזהה 319403497", "hapoalim_bank_account", -1418.05),
    "transfer"
  );
  assert.equal(
    transfers.detectKind("ל.מאסטרקרד(יש)", "leumi_bank_account", -3618.16),
    "transfer"
  );
});

test("parses Ollama JSON object wrappers", async () => {
  const { parseCategorizationResponse } = await import(
    "../src/server/ai/parse-response.ts"
  );
  assert.equal(typeof parseCategorizationResponse, "function");

  assert.deepEqual(
    parseCategorizationResponse(
      JSON.stringify({
        transactions: [
          { index: 0, categoryName: "Groceries", confidence: 6 },
          { index: 1, categoryName: "Pet Supplies", isNew: true, confidence: 4 },
        ],
      }),
      ["Groceries"],
      true
    ),
    [
      {
        index: 0,
        categoryName: "Groceries",
        isNew: false,
        confidence: 6,
      },
      {
        index: 1,
        categoryName: "Pet Supplies",
        isNew: true,
        confidence: 4,
      },
    ]
  );
});

test("parses a single Ollama mapping object", async () => {
  const { parseCategorizationResponse } = await import(
    "../src/server/ai/parse-response.ts"
  );

  assert.deepEqual(
    parseCategorizationResponse(
      JSON.stringify({ index: 0, categoryName: "Groceries", confidence: 6 }),
      ["Groceries"],
      false
    ),
    [
      {
        index: 0,
        categoryName: "Groceries",
        isNew: false,
        confidence: 6,
      },
    ]
  );
});

test("uses deterministic low-memory options for Ollama categorization", async () => {
  const { OllamaProvider } = await import(
    "../src/server/ai/providers/ollama.ts"
  );
  const originalFetch = globalThis.fetch;
  let requestBody;
  let observedPrompt;

  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        message: {
          content: JSON.stringify([
            { index: 0, categoryName: "Groceries", confidence: 7 },
          ]),
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  try {
    const provider = new OllamaProvider(
      "http://localhost:11434",
      "qwen3.5:9b"
    );

    await provider.categorize(
      [{ description: "Supermarket", amount: -100, currency: "ILS" }],
      [{ name: "Groceries", description: "Food stores" }],
      {
        matchingHistory: [
          {
            normalizedDescription: "supermarket",
            displayDescription: "Supermarket",
            total: 4,
            categories: [{ categoryName: "Groceries", count: 4 }],
          },
        ],
        onPrompt(observation) {
          observedPrompt = observation;
        },
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requestBody.think, false);
  assert.deepEqual(requestBody.options, {
    temperature: 0,
    num_ctx: 8192,
  });
  assert.deepEqual(observedPrompt, {
    systemPrompt: requestBody.messages[0].content,
    userPrompt: requestBody.messages[1].content,
  });
});

test("proposal prompt matches main classification behavior", async () => {
  const { buildCategorizationPrompt } = await import(
    "../src/server/ai/prompts.ts"
  );

  const prompt = buildCategorizationPrompt(
    [{ description: "Supermarket", amount: -100, currency: "ILS" }],
    [{ name: "Groceries", description: "Food stores" }],
    true
  );

  assert.match(prompt, /When no existing category is a good fit, propose a new one/);
  assert.match(prompt, /If you propose a new category, add "isNew": true/);
  assert.match(prompt, /Don't over-propose/);
});

test("renders matching history once per normalized description without transaction numbers", async () => {
  const { buildCategorizationPrompt } = await import(
    "../src/server/ai/prompts.ts"
  );

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

  assert.equal(
    (prompt.match(/Matching description history:/g) ?? []).length,
    1
  );
  assert.equal((prompt.match(/Groceries: 4\. Total: 4\./g) ?? []).length, 1);
  assert.doesNotMatch(prompt, /Transaction 0, "AM:PM"/);
  assert.match(prompt, /0: "AM:PM" \| ILS 84\.20/);
  assert.match(prompt, /1: "am:pm 123" \| ILS 42\.10/);
  assert.match(
    prompt,
    /Matching-description history contains prior categorized transactions/
  );
});

test("classifies imported card transaction providers as card sources", () => {
  assert.equal(
    sourceTypes.getTransactionSourceType("max_bill"),
    "card"
  );
  assert.equal(sourceTypes.getTransactionSourceType("cal_bill"), "card");
  assert.equal(sourceTypes.getTransactionSourceType("isracard_bill"), "card");
  assert.equal(sourceTypes.getTransactionSourceType("hapoalim_bank_account"), "bank");
  assert.equal(sourceTypes.getTransactionSourceType("leumi_bank_account"), "bank");
});

test("labels imported transaction providers by institution name", () => {
  assert.equal(sourceTypes.getTransactionProviderLabel("isracard_bill"), "Isracard");
  assert.equal(sourceTypes.getTransactionProviderLabel("max_bill"), "Max");
  assert.equal(sourceTypes.getTransactionProviderLabel("cal_bill"), "CAL");
  assert.equal(sourceTypes.getTransactionProviderLabel("hapoalim_bank_account"), "Hapoalim");
  assert.equal(sourceTypes.getTransactionProviderLabel("leumi_bank_account"), "Leumi");
  assert.equal(sourceTypes.getTransactionProviderLabel("hapoalim"), null);
});

test("combines category counts across normalized description variants", async () => {
  const { buildDescriptionHistory } = await import(
    "../src/server/sync/description-history.ts"
  );
  const history = buildDescriptionHistory([
    {
      description: " AM:PM  ",
      categoryId: 10,
      categoryName: "Groceries",
      count: 2,
    },
    {
      description: "am:pm 123",
      categoryId: 10,
      categoryName: "Groceries",
      count: 1,
    },
    {
      description: "am:pm",
      categoryId: 11,
      categoryName: "Restaurants",
      count: 1,
    },
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
    {
      route: "database",
      reason: "majority-vote",
      categoryId: 10,
      categoryName: "Groceries",
    }
  );
});

test("routes four history matches to AI", async () => {
  const { decideDescriptionHistory } = await import(
    "../src/server/sync/description-history.ts"
  );

  assert.deepEqual(
    decideDescriptionHistory({
      normalizedDescription: "am:pm",
      total: 4,
      categories: [
        { categoryId: 10, categoryName: "Groceries", count: 3 },
        { categoryId: 11, categoryName: "Restaurants", count: 1 },
      ],
    }),
    {
      route: "ai",
      reason: "below-threshold",
      categoryId: null,
      categoryName: null,
    }
  );
});

test("routes a top-count history tie to AI", async () => {
  const { decideDescriptionHistory } = await import(
    "../src/server/sync/description-history.ts"
  );

  assert.deepEqual(
    decideDescriptionHistory({
      normalizedDescription: "am:pm",
      total: 6,
      categories: [
        { categoryId: 10, categoryName: "Groceries", count: 3 },
        { categoryId: 11, categoryName: "Restaurants", count: 3 },
      ],
    }),
    {
      route: "ai",
      reason: "tied-vote",
      categoryId: null,
      categoryName: null,
    }
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

test("history query isolates workspace kind and categorized rows", async () => {
  const { default: Database } = await import("better-sqlite3");
  const { queryCategorizedDescriptionCounts } = await import(
    "../src/server/sync/description-history.ts"
  );
  const db = new Database(":memory:");

  try {
    db.exec(`
      CREATE TABLE categories (
        id INTEGER PRIMARY KEY,
        workspace_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL
      );
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY,
        workspace_id INTEGER NOT NULL,
        description TEXT NOT NULL,
        kind TEXT NOT NULL,
        category_id INTEGER
      );
      INSERT INTO categories VALUES
        (10, 1, 'Groceries', 'expense'),
        (11, 1, 'Restaurants', 'expense'),
        (12, 1, 'Salary', 'income'),
        (20, 2, 'Workspace Two', 'expense');
      INSERT INTO transactions VALUES
        (1, 1, 'AM:PM', 'expense', 10),
        (2, 1, 'AM:PM', 'expense', 10),
        (3, 1, 'AM:PM', 'expense', NULL),
        (4, 1, 'AM:PM', 'income', 12),
        (5, 2, 'AM:PM', 'expense', 20);
    `);

    assert.deepEqual(queryCategorizedDescriptionCounts(db, 1, "expense"), [
      {
        description: "AM:PM",
        categoryId: 10,
        categoryName: "Groceries",
        count: 2,
      },
    ]);

    db.prepare("UPDATE transactions SET category_id = 11 WHERE id = 2").run();
    assert.deepEqual(queryCategorizedDescriptionCounts(db, 1, "expense"), [
      {
        description: "AM:PM",
        categoryId: 10,
        categoryName: "Groceries",
        count: 1,
      },
      {
        description: "AM:PM",
        categoryId: 11,
        categoryName: "Restaurants",
        count: 1,
      },
    ]);
  } finally {
    db.close();
  }
});

test("plans memory database and AI routes with unique prompt history", async () => {
  const { planDescriptionHistoryRoutes } = await import(
    "../src/server/sync/description-history.ts"
  );
  const transactions = [
    { id: 1, description: "Known Memory" },
    { id: 2, description: "Five Wins" },
    { id: 3, description: "Four Needs AI" },
    { id: 4, description: "Tie Needs AI" },
    { id: 5, description: "four needs ai 99" },
  ];
  const history = new Map([
    [
      "five wins",
      {
        normalizedDescription: "five wins",
        total: 5,
        categories: [
          { categoryId: 10, categoryName: "Groceries", count: 3 },
          { categoryId: 11, categoryName: "Restaurants", count: 2 },
        ],
      },
    ],
    [
      "four needs ai",
      {
        normalizedDescription: "four needs ai",
        total: 4,
        categories: [
          { categoryId: 10, categoryName: "Groceries", count: 3 },
          { categoryId: 11, categoryName: "Restaurants", count: 1 },
        ],
      },
    ],
    [
      "tie needs ai",
      {
        normalizedDescription: "tie needs ai",
        total: 6,
        categories: [
          { categoryId: 10, categoryName: "Groceries", count: 3 },
          { categoryId: 11, categoryName: "Restaurants", count: 3 },
        ],
      },
    ],
  ]);

  const plan = planDescriptionHistoryRoutes(
    transactions,
    new Set([1]),
    history
  );

  assert.deepEqual(plan.memoryTransactions.map((transaction) => transaction.id), [
    1,
  ]);
  assert.deepEqual(
    plan.databaseTransactions.map(({ transaction, decision }) => ({
      id: transaction.id,
      categoryId: decision.categoryId,
    })),
    [{ id: 2, categoryId: 10 }]
  );
  assert.deepEqual(plan.aiTransactions.map(({ transaction }) => transaction.id), [
    3, 4, 5,
  ]);
  assert.deepEqual(plan.matchingHistory, [
    {
      normalizedDescription: "four needs ai",
      displayDescription: "Four Needs AI",
      total: 4,
      categories: [
        { categoryName: "Groceries", count: 3 },
        { categoryName: "Restaurants", count: 1 },
      ],
    },
    {
      normalizedDescription: "tie needs ai",
      displayDescription: "Tie Needs AI",
      total: 6,
      categories: [
        { categoryName: "Groceries", count: 3 },
        { categoryName: "Restaurants", count: 3 },
      ],
    },
  ]);
});

test("classification report focuses five-plus rows and preserves exact prompts", async () => {
  const { buildClassificationReport, renderClassificationReportMarkdown } =
    await import(
    "../scripts/debug-import-classification.mjs"
    );
  const report = buildClassificationReport({
    generatedAt: "2026-08-01T12:00:00.000Z",
    sourceDatabase: "data/spent.db",
    targetDatabase: "data/personal-dev/spent.db",
    workspace: { id: 21, name: "personal-dev" },
    files: [],
    importTotals: { added: 2, updated: 0, duplicates: 0 },
    importedTransactionIds: [7, 8],
    events: [
      {
        type: "decision",
        transactionId: 7,
        description: "A",
        normalizedDescription: "a",
        kind: "expense",
        historicalMatchCount: 5,
        history: [{ category: "Groceries", count: 5 }],
        route: "database",
        reason: "majority-vote",
        selectedCategory: "Groceries",
      },
      {
        type: "ai-batch",
        kind: "expense",
        transactionIds: [8],
        systemPrompt: "system",
        userPrompt: "exact prompt",
        mappings: [],
        updates: [],
        error: null,
      },
    ],
    aiWarning: null,
  });

  assert.equal(report.newRowDecisions.length, 1);
  assert.equal(report.fivePlusRows.length, 1);
  assert.equal(report.fivePlusRows[0].transactionId, 7);
  assert.equal(report.aiBatches[0].userPrompt, "exact prompt");
  const markdown = renderClassificationReportMarkdown(report);
  assert.match(markdown, /A \| a \| 5 \| Groceries: 5 \| database/);
  assert.match(markdown, /## AI Batch 1/);
  assert.match(markdown, /exact prompt/);
});

test("loads the migration runner under the ESM diagnostic runtime", async () => {
  const { runMigrations } = await import("../src/server/db/migrate.ts");
  assert.equal(typeof runMigrations, "function");
});

test("builds exact replay targets for duplicate sequences in each file", async () => {
  const { buildReplayTargets } = await import(
    "../scripts/debug-import-classification.mjs"
  );

  assert.deepEqual(
    buildReplayTargets([
      {
        fileName: "first.xlsx",
        rows: [
          { dedupHash: "same", duplicate: true },
          { dedupHash: "same", duplicate: true },
          { dedupHash: "new", duplicate: false },
        ],
      },
      {
        fileName: "second.xlsx",
        rows: [{ dedupHash: "same", duplicate: true }],
      },
    ]),
    [
      { dedupHash: "same", dedupSequence: 0 },
      { dedupHash: "same", dedupSequence: 1 },
      { dedupHash: "same", dedupSequence: 0 },
    ]
  );
});
