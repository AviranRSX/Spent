import "server-only";

import type { CategoryMapping } from "./types";

function parseConfidence(raw: unknown): number | undefined {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return undefined;
  const clamped = Math.round(n);
  if (clamped < 1 || clamped > 7) return undefined;
  return clamped;
}

function parseJsonCandidate(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        return null;
      }
    }

    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch {
        return null;
      }
    }

    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function extractItems(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];

  const record = parsed as Record<string, unknown>;
  if (
    (record.index != null ||
      record.transactionIndex != null ||
      record.transaction_id != null) &&
    (record.categoryName != null ||
      record.category != null ||
      record.category_name != null)
  ) {
    return [record];
  }

  for (const key of ["transactions", "assignments", "mappings", "results"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }

  return [];
}

function readIndex(item: Record<string, unknown>): number | null {
  const raw = item.index ?? item.transactionIndex ?? item.transaction_id;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function readCategoryName(item: Record<string, unknown>): string | null {
  const raw = item.categoryName ?? item.category ?? item.category_name;
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

export function parseCategorizationResponse(
  text: string,
  validCategories: string[],
  allowProposals: boolean
): CategoryMapping[] {
  const parsed = parseJsonCandidate(text);
  const items = extractItems(parsed);
  if (items.length === 0) return [];

  const validSet = new Set(validCategories.map((c) => c.toLowerCase()));
  const results: CategoryMapping[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const index = readIndex(record);
    const name = readCategoryName(record);
    if (index == null || name == null) continue;

    const isExisting = validSet.has(name.toLowerCase());
    if (!isExisting && !allowProposals) continue;

    results.push({
      index,
      categoryName: name,
      isNew: !isExisting,
      confidence: parseConfidence(record.confidence),
    });
  }

  return results;
}
