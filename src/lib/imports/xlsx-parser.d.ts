import type { ImportTemplateType } from "@/lib/types";

export interface ParsedImportTransaction {
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
}

export interface ParsedImportRowIssue {
  sheetName: string;
  rowNumber: number;
  problems: string[];
}

export type ImportDetectionResult =
  | {
      ok: true;
      templateType: ImportTemplateType;
      kind: "bank" | "card";
    }
  | {
      ok: false;
      code: "unsupported" | "ambiguous" | "unreadable";
      message: string;
      matches: ImportTemplateType[];
    };

export const MAX_OPEN_XML_ENTRIES: number;
export const MAX_OPEN_XML_EXPANDED_BYTES: number;

export function getOpenXmlArchiveLimitIssue(
  expandedSizes: number[]
): "entry_count" | "expanded_size" | null;

export function detectWorkbookBuffer(buffer: Buffer): Promise<ImportDetectionResult>;

export function parseWorkbookBuffer(
  buffer: Buffer,
  options: { templateType: ImportTemplateType; sourceLabel: string }
): Promise<{
  transactions: ParsedImportTransaction[];
  rowIssues: ParsedImportRowIssue[];
}>;
