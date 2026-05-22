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

export interface ParsedImportError {
  sheetName: string;
  rowNumber: number;
  message: string;
}

export function parseWorkbookBuffer(
  buffer: Buffer,
  options: { templateType: ImportTemplateType; sourceLabel: string }
): Promise<{
  transactions: ParsedImportTransaction[];
  errors: ParsedImportError[];
}>;
