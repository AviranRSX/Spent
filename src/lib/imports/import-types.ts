import type { ImportSourceKind, ImportTemplateType } from "@/lib/types";

export interface ImportRowIssue {
  sheetName: string;
  rowNumber: number;
  problems: string[];
}

export interface ImportFileIssue {
  code: "unsupported" | "ambiguous" | "unreadable";
  message: string;
  matches: ImportTemplateType[];
}

export interface ImportPreviewRow {
  accountNumber: string;
  date: string;
  processedDate: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  chargedCurrency?: string;
  description: string;
  memo?: string;
  type: "normal" | "installments";
  status: "completed" | "pending";
  identifier?: string | number;
  dedupHash: string;
  duplicate: boolean;
}

export interface ImportPreviewFile {
  fileName: string;
  kind: ImportSourceKind | null;
  templateType: ImportTemplateType | null;
  rows: ImportPreviewRow[];
  duplicateCount: number;
  rowIssues: ImportRowIssue[];
  fileIssue: ImportFileIssue | null;
}

export interface ImportPreviewSummary {
  validRows: number;
  duplicates: number;
  skippedRows: number;
  fileErrors: number;
  importableRows: number;
}
