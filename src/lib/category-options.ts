import type { Category } from "./types";

export interface CategoryOptionGroup {
  /** Parent category name, or null for leaves without a group. */
  parentName: string | null;
  options: Category[];
}

/**
 * Pickable leaves grouped under their parent. Groups sort by parent name and
 * leaves keep the order the list arrives in. Parents themselves are rollups,
 * so they are headers, never options. Ungrouped leaves come last.
 */
export function groupCategoryOptions(categories: readonly Category[]): CategoryOptionGroup[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const parentIds = new Set<number>();
  for (const c of categories) if (c.parentId != null) parentIds.add(c.parentId);

  const groups = new Map<number, CategoryOptionGroup>();
  const ungrouped: Category[] = [];
  for (const c of categories) {
    if (parentIds.has(c.id)) continue;
    const parent = c.parentId != null ? byId.get(c.parentId) : undefined;
    if (!parent) {
      ungrouped.push(c);
      continue;
    }
    const group = groups.get(parent.id) ?? { parentName: parent.name, options: [] };
    group.options.push(c);
    groups.set(parent.id, group);
  }

  const result = [...groups.values()].sort((a, b) =>
    (a.parentName ?? "").localeCompare(b.parentName ?? "")
  );
  if (ungrouped.length > 0) result.push({ parentName: null, options: ungrouped });
  return result;
}
