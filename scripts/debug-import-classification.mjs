import fs from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const target = path.join(REPO_ROOT, "src", specifier.slice(2));
      return nextResolve(pathToFileURL(`${target}.ts`).href, context);
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

function escapeTable(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function renderHistory(history) {
  return history.map((item) => `${item.category}: ${item.count}`).join(", ");
}

export function buildReplayTargets(previews) {
  const targets = [];
  for (const preview of previews) {
    const sequenceByHash = new Map();
    for (const row of preview.rows) {
      const dedupSequence = sequenceByHash.get(row.dedupHash) ?? 0;
      sequenceByHash.set(row.dedupHash, dedupSequence + 1);
      if (row.duplicate) {
        targets.push({ dedupHash: row.dedupHash, dedupSequence });
      }
    }
  }
  return targets;
}

export function buildClassificationReport(input) {
  const importedTransactionIds = new Set(input.importedTransactionIds);
  const finalById = new Map(
    (input.finalTransactions ?? []).map((transaction) => [
      transaction.id,
      transaction,
    ])
  );
  const newRowDecisions = input.events
    .filter(
      (event) =>
        event.type === "decision" &&
        importedTransactionIds.has(event.transactionId)
    )
    .map((decision) => ({
      ...decision,
      finalTransaction: finalById.get(decision.transactionId) ?? null,
    }));

  return {
    generatedAt: input.generatedAt,
    sourceDatabase: input.sourceDatabase,
    targetDatabase: input.targetDatabase,
    workspace: input.workspace,
    files: input.files,
    importTotals: input.importTotals,
    replayedExistingRows: input.replayedExistingRows ?? 0,
    newRowDecisions,
    fivePlusRows: newRowDecisions.filter(
      (decision) => decision.historicalMatchCount >= 5
    ),
    aiBatches: input.events.filter((event) => event.type === "ai-batch"),
    aiWarning: input.aiWarning,
  };
}

function renderDecisionTable(decisions) {
  const rows = decisions.map((decision) => {
    const final = decision.finalTransaction;
    return `| ${escapeTable(decision.description)} | ${escapeTable(decision.normalizedDescription)} | ${decision.historicalMatchCount} | ${escapeTable(renderHistory(decision.history))} | ${decision.route} | ${decision.reason} | ${escapeTable(decision.selectedCategory ?? final?.categoryName ?? "")} | ${escapeTable(final?.aiConfidence ?? "")} | ${final?.needsReview ? "yes" : "no"} |`;
  });
  return [
    "| Description | Normalized | Matches | History | Route | Reason | Final category | AI confidence | Needs review |",
    "|---|---|---:|---|---|---|---|---:|---|",
    ...rows,
  ].join("\n");
}

export function renderClassificationReportMarkdown(report) {
  const fileRows = report.files.map(
    (file) =>
      `| ${escapeTable(file.fileName)} | ${escapeTable(file.status)} | ${file.rowCount} | ${file.duplicateCount} | ${file.rowIssueCount} | ${escapeTable(file.message ?? "")} |`
  );
  const sections = [
    "# Import Classification Debug Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Workspace: ${report.workspace.name} (${report.workspace.id})`,
    `Source database: ${report.sourceDatabase}`,
    `Target database: ${report.targetDatabase}`,
    `AI warning: ${report.aiWarning ?? "none"}`,
    "",
    "## Import Summary",
    "",
    `Added: ${report.importTotals.added}`,
    `Updated: ${report.importTotals.updated}`,
    `Duplicates: ${report.importTotals.duplicates}`,
    `Existing copied rows removed for replay: ${report.replayedExistingRows}`,
    "",
    "| File | Status | Rows | Duplicates | Row issues | Message |",
    "|---|---|---:|---:|---:|---|",
    ...fileRows,
    "",
    "## New Row Decisions",
    "",
    renderDecisionTable(report.newRowDecisions),
    "",
    "## Rows With At Least 5 Historical Matches",
    "",
    renderDecisionTable(report.fivePlusRows),
  ];

  report.aiBatches.forEach((batch, index) => {
    sections.push(
      "",
      `## AI Batch ${index + 1}`,
      "",
      `Kind: ${batch.kind}`,
      `Transaction IDs: ${batch.transactionIds.join(", ")}`,
      `Error: ${batch.error ?? "none"}`,
      "",
      "### System Prompt",
      "",
      "```text",
      batch.systemPrompt,
      "```",
      "",
      "### User Prompt",
      "",
      "```text",
      batch.userPrompt,
      "```",
      "",
      "### Model Mappings",
      "",
      "```json",
      JSON.stringify(batch.mappings, null, 2),
      "```",
      "",
      "### Applied Updates",
      "",
      "```json",
      JSON.stringify(batch.updates, null, 2),
      "```"
    );
  });

  return `${sections.join("\n")}\n`;
}

async function removePreviousTargetFiles(targetDataDir) {
  const names = [
    "spent.db",
    "spent.db-wal",
    "spent.db-shm",
    "classification-report.json",
    "classification-report.md",
  ];
  for (const name of names) {
    await fs.rm(path.join(targetDataDir, name), { force: true });
  }
}

async function loadWorkbooks(transactionsDir) {
  const entries = await fs.readdir(transactionsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .sort((a, b) => a.name.localeCompare(b.name));
  return Promise.all(
    files.map(async (entry) => ({
      fileName: entry.name,
      buffer: await fs.readFile(path.join(transactionsDir, entry.name)),
    }))
  );
}

async function main() {
  const sourceDbPath = path.resolve(REPO_ROOT, "data", "spent.db");
  const targetDataDir = path.resolve(REPO_ROOT, "data", "personal-dev");
  const expectedTargetDataDir = path.resolve(
    REPO_ROOT,
    "data",
    "personal-dev"
  );
  const targetDbPath = path.join(targetDataDir, "spent.db");
  const transactionsDir = path.resolve(REPO_ROOT, "transactions");

  if (targetDataDir !== expectedTargetDataDir) {
    throw new Error("Refusing to write outside data/personal-dev");
  }

  await fs.mkdir(targetDataDir, { recursive: true });
  await removePreviousTargetFiles(targetDataDir);

  const sourceDb = new Database(sourceDbPath, { readonly: true });
  try {
    await sourceDb.backup(targetDbPath);
  } finally {
    sourceDb.close();
  }

  process.env.SPENT_DATA_DIR = targetDataDir;

  const parser = await import("../src/lib/imports/xlsx-parser.js");
  const templates = await import("../src/lib/imports/templates.js");
  const { previewImportWorkbooks } = await import(
    "../src/server/imports/preview-workbooks.ts"
  );
  const { previewImportRows, commitImportFiles } = await import(
    "../src/server/imports/import-transactions.ts"
  );
  const { categorizeWorkspaceTransactions } = await import(
    "../src/server/sync/categorization.ts"
  );
  const { getDb } = await import("../src/server/db/index.ts");
  const { listWorkspaces, updateWorkspace } = await import(
    "../src/server/db/queries/workspaces.ts"
  );

  const personalWorkspace = listWorkspaces().find(
    (workspace) => workspace.name.toLowerCase() === "personal"
  );
  if (!personalWorkspace) {
    throw new Error('Copied database does not contain a "Personal" workspace');
  }
  const workspace = updateWorkspace(personalWorkspace.id, "personal-dev");
  const db = getDb();
  const beforeIds = new Set(
    (
      db
        .prepare("SELECT id FROM transactions WHERE workspace_id = ?")
        .all(workspace.id)
    ).map((row) => row.id)
  );

  const workbooks = await loadWorkbooks(transactionsDir);
  const previewDependencies = {
    detectWorkbookBuffer: parser.detectWorkbookBuffer,
    parseWorkbookBuffer: parser.parseWorkbookBuffer,
    getImportTemplateLabel: templates.getImportTemplateLabel,
    previewImportRows,
  };
  let previews = await previewImportWorkbooks(
    workspace.id,
    workbooks,
    previewDependencies
  );
  const replayTargets = buildReplayTargets(previews);
  const deleteReplayTarget = db.prepare(
    `DELETE FROM transactions
     WHERE workspace_id = ? AND dedup_hash = ? AND dedup_sequence = ?`
  );
  let replayedExistingRows = 0;
  db.transaction(() => {
    for (const target of replayTargets) {
      replayedExistingRows += deleteReplayTarget.run(
        workspace.id,
        target.dedupHash,
        target.dedupSequence
      ).changes;
    }
  })();
  if (replayedExistingRows > 0) {
    previews = await previewImportWorkbooks(
      workspace.id,
      workbooks,
      previewDependencies
    );
  }
  const files = previews.map((preview) => ({
    fileName: preview.fileName,
    status: preview.fileIssue ? preview.fileIssue.code : "imported",
    rowCount: preview.rows.length,
    duplicateCount: preview.duplicateCount,
    rowIssueCount: preview.rowIssues.length,
    message: preview.fileIssue?.message ?? null,
    rowIssues: preview.rowIssues,
  }));
  const commitFiles = previews
    .filter(
      (preview) =>
        preview.fileIssue == null &&
        preview.kind != null &&
        preview.templateType != null
    )
    .map((preview) => ({
      fileName: preview.fileName,
      kind: preview.kind,
      templateType: preview.templateType,
      rows: preview.rows,
    }));
  const commitResult = await commitImportFiles(
    workspace.id,
    workspace.name,
    commitFiles,
    { categorize: false }
  );

  const afterIds = db
    .prepare("SELECT id FROM transactions WHERE workspace_id = ?")
    .all(workspace.id)
    .map((row) => row.id);
  const importedTransactionIds = afterIds.filter((id) => !beforeIds.has(id));
  const events = [];
  const categorizedResult = await categorizeWorkspaceTransactions(
    workspace.id,
    workspace.name,
    undefined,
    (event) => events.push(event)
  );
  const finalTransactions = db
    .prepare(
      `SELECT t.id,
              c.name as categoryName,
              t.ai_confidence as aiConfidence,
              t.needs_review = 1 as needsReview
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.workspace_id = ?`
    )
    .all(workspace.id);

  const report = buildClassificationReport({
    generatedAt: new Date().toISOString(),
    sourceDatabase: sourceDbPath,
    targetDatabase: targetDbPath,
    workspace: { id: workspace.id, name: workspace.name },
    files,
    importTotals: {
      added: commitResult.added,
      updated: commitResult.updated,
      duplicates: previews.reduce(
        (sum, preview) => sum + preview.duplicateCount,
        0
      ),
    },
    replayedExistingRows,
    importedTransactionIds,
    finalTransactions,
    events,
    aiWarning: categorizedResult.aiWarning,
  });

  await fs.writeFile(
    path.join(targetDataDir, "classification-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(targetDataDir, "classification-report.md"),
    renderClassificationReportMarkdown(report),
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        targetDatabase: targetDbPath,
        importedTransactions: importedTransactionIds.length,
        decisions: report.newRowDecisions.length,
        fivePlusRows: report.fivePlusRows.length,
        aiBatches: report.aiBatches.length,
        aiWarning: report.aiWarning,
      },
      null,
      2
    )
  );
}

const isMain =
  process.argv[1] != null &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
