import { TRAVEL_CATEGORY_NAMES } from "./membership";
import type { TransactionTripInfo, TripRef } from "./types";

export function isTravelCategoryName(name: string | null): boolean {
  return name != null && TRAVEL_CATEGORY_NAMES.includes(name);
}

/**
 * Suggestions to show after a category change, or null for no prompt. Only
 * rows that landed in the needs-a-trip queue get asked; a row already in a
 * trip or marked "not a trip" is left alone.
 */
export function tripPromptSuggestions(
  categoryName: string,
  info: TransactionTripInfo | undefined
): TripRef[] | null {
  if (!isTravelCategoryName(categoryName)) return null;
  if (info?.kind !== "queue") return null;
  return info.suggestions;
}
