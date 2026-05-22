import "server-only";

import { getDb } from "../index";
import type { ImportSource, ImportSourceKind, ImportTemplateType } from "@/lib/types";

export interface SaveImportSourceInput {
  label: string;
  kind: ImportSourceKind;
  templateType: ImportTemplateType;
  accountHint?: string | null;
}

interface ImportSourceRow {
  id: number;
  label: string;
  kind: ImportSourceKind;
  template_type: ImportTemplateType;
  account_hint: string | null;
  created_at: string;
  updated_at: string;
  last_import_at: string | null;
  transaction_count: number;
}

function normalizeLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Label is required");
  if (trimmed.length > 128) throw new Error("Label must be 128 characters or fewer");
  return trimmed;
}

function mapRow(row: ImportSourceRow): ImportSource {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    templateType: row.template_type,
    accountHint: row.account_hint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastImportAt: row.last_import_at,
    transactionCount: row.transaction_count,
  };
}

export function listImportSources(workspaceId: number): ImportSource[] {
  const rows = getDb()
    .prepare(
      `SELECT s.id, s.label, s.kind, s.template_type, s.account_hint,
              s.created_at, s.updated_at,
              MAX(r.completed_at) as last_import_at,
              COUNT(t.id) as transaction_count
       FROM import_sources s
       LEFT JOIN sync_runs r
         ON r.import_source_id = s.id AND r.status = 'completed'
       LEFT JOIN transactions t
         ON t.import_source_id = s.id
       WHERE s.workspace_id = ?
       GROUP BY s.id
       ORDER BY s.kind, s.label`
    )
    .all(workspaceId) as ImportSourceRow[];
  return rows.map(mapRow);
}

export function getImportSource(
  workspaceId: number,
  sourceId: number
): ImportSource | null {
  return listImportSources(workspaceId).find((s) => s.id === sourceId) ?? null;
}

export function createImportSource(
  workspaceId: number,
  input: SaveImportSourceInput
): number {
  const result = getDb()
    .prepare(
      `INSERT INTO import_sources (
         workspace_id, label, kind, template_type, account_hint, updated_at
       ) VALUES (?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(
      workspaceId,
      normalizeLabel(input.label),
      input.kind,
      input.templateType,
      input.accountHint?.trim() || null
    );
  return Number(result.lastInsertRowid);
}

export function hasImportSources(workspaceId: number): boolean {
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM import_sources WHERE workspace_id = ?")
    .get(workspaceId) as { count: number };
  return row.count > 0;
}
