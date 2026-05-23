import "server-only";

import { completeSyncRun, createSyncRun } from "@/server/db/queries/sync-runs";
import {
  countExistingDedupHashes,
  insertTransactions,
} from "@/server/db/queries/transactions";
import { computeDedupHash } from "@/server/lib/dedup";
import { categorizeWorkspaceTransactions } from "@/server/sync/categorization";
import { toLocalISODate } from "@/server/lib/date-utils";
import type { ImportSourceKind, ImportTemplateType } from "@/lib/types";
import type { ParsedImportTransaction } from "@/lib/imports/xlsx-parser";

export interface ImportPreviewRow extends ParsedImportTransaction {
  dedupHash: string;
  duplicate: boolean;
}

export interface ImportPreviewFile {
  fileName: string;
  kind: ImportSourceKind;
  templateType: ImportTemplateType;
  rows: ImportPreviewRow[];
  duplicateCount: number;
  errors: Array<{ sheetName: string; rowNumber: number; message: string }>;
}

export interface ImportCommitFile {
  fileName: string;
  kind: ImportSourceKind;
  templateType: ImportTemplateType;
  rows: ImportPreviewRow[];
}

function withDedup(rows: ParsedImportTransaction[]): ImportPreviewRow[] {
  return rows.map((txn) => ({
    ...txn,
    dedupHash: computeDedupHash({
      accountNumber: txn.accountNumber,
      date: txn.date,
      originalAmount: txn.originalAmount,
      originalCurrency: txn.originalCurrency,
      description: txn.description,
      identifier: txn.identifier,
    }),
    duplicate: false,
  }));
}

export function previewImportRows(
  workspaceId: number,
  rows: ParsedImportTransaction[]
): { rows: ImportPreviewRow[]; duplicateCount: number } {
  const previewRows = withDedup(rows);
  const existingCounts = countExistingDedupHashes(
    workspaceId,
    previewRows.map((row) => row.dedupHash)
  );
  const batchCounts = new Map<string, number>();
  let duplicateCount = 0;

  for (const row of previewRows) {
    const batchCount = (batchCounts.get(row.dedupHash) ?? 0) + 1;
    batchCounts.set(row.dedupHash, batchCount);
    const existing = existingCounts.get(row.dedupHash) ?? 0;
    row.duplicate = batchCount <= existing;
    if (row.duplicate) duplicateCount += 1;
  }

  return { rows: previewRows, duplicateCount };
}

export async function commitImportFiles(
  workspaceId: number,
  workspaceName: string,
  files: ImportCommitFile[],
  options: { categorize?: boolean } = {}
): Promise<{
  added: number;
  updated: number;
  categorized: number;
  aiWarning: string | null;
}> {
  let added = 0;
  let updated = 0;

  for (const file of files) {
    const fromDate = file.rows[0]?.date ?? toLocalISODate(new Date());
    const syncRunId = createSyncRun(
      workspaceId,
      file.templateType,
      null,
      fromDate,
      null
    );
    const result = insertTransactions(
      workspaceId,
      file.rows,
      file.templateType,
      null,
      syncRunId,
      { importSourceId: null }
    );
    completeSyncRun(syncRunId, result.added, result.updated);
    added += result.added;
    updated += result.updated;
  }

  const categorizedResult =
    options.categorize === false
      ? { categorized: 0, aiWarning: null }
      : await categorizeWorkspaceTransactions(workspaceId, workspaceName);

  return {
    added,
    updated,
    categorized: categorizedResult.categorized,
    aiWarning: categorizedResult.aiWarning,
  };
}
