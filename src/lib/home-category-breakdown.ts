import type {
  HomeCategoryBreakdown,
  HomeCategoryBreakdownChild,
  HomeCategoryBreakdownGroup,
} from "./types";

export interface BreakdownCategory {
  id: number;
  parentId: number | null;
  name: string;
  color: string;
}

export interface BreakdownSpendRow {
  categoryId: number | null;
  amount: number;
}

export interface DonutSlice {
  key: string;
  categoryId: number | null;
  name: string | null;
  color: string | null;
  amount: number;
  share: number;
  isOther: boolean;
}

interface GroupAccumulator {
  amount: number;
  categoryIds: Set<number>;
  children: Map<number, number>;
}

export function buildCategoryBreakdown(input: {
  month: string;
  isCurrentMonth: boolean;
  categories: BreakdownCategory[];
  monthRows: BreakdownSpendRow[];
  averageRows: BreakdownSpendRow[];
  averageMonths: number;
}): HomeCategoryBreakdown {
  const byId = new Map(input.categories.map((category) => [category.id, category]));

  // A leaf rolls up to its parent; a category without a parent is its own
  // group, so a workspace with no parent groups falls back to leaves.
  // Unknown ids join the uncategorized bucket so totals still add up.
  const groupIdFor = (categoryId: number | null): number | null => {
    if (categoryId == null) return null;
    const category = byId.get(categoryId);
    if (!category) return null;
    if (category.parentId != null && byId.has(category.parentId)) {
      return category.parentId;
    }
    return category.id;
  };

  const total = input.monthRows.reduce((sum, row) => sum + row.amount, 0);
  const shareOf = (amount: number) => (total > 0 ? amount / total : 0);

  const accumulators = new Map<number | null, GroupAccumulator>();
  for (const row of input.monthRows) {
    if (row.amount === 0) continue;
    const groupId = groupIdFor(row.categoryId);
    const group = accumulators.get(groupId) ?? {
      amount: 0,
      categoryIds: new Set<number>(),
      children: new Map<number, number>(),
    };
    group.amount += row.amount;
    if (groupId != null && row.categoryId != null) {
      group.categoryIds.add(row.categoryId);
      if (row.categoryId !== groupId) {
        group.children.set(
          row.categoryId,
          (group.children.get(row.categoryId) ?? 0) + row.amount
        );
      }
    }
    accumulators.set(groupId, group);
  }

  const averageTotals = new Map<number | null, number>();
  for (const row of input.averageRows) {
    const groupId = groupIdFor(row.categoryId);
    averageTotals.set(groupId, (averageTotals.get(groupId) ?? 0) + row.amount);
  }

  const groups: HomeCategoryBreakdownGroup[] = [];
  for (const [groupId, group] of accumulators) {
    const category = groupId != null ? byId.get(groupId) : undefined;
    const children: HomeCategoryBreakdownChild[] = [];
    for (const [childId, amount] of group.children) {
      const child = byId.get(childId);
      if (!child) continue;
      children.push({
        categoryId: childId,
        name: child.name,
        color: child.color,
        amount,
        share: shareOf(amount),
      });
    }
    children.sort((a, b) => b.amount - a.amount);

    groups.push({
      categoryId: groupId,
      name: category?.name ?? null,
      color: category?.color ?? null,
      amount: group.amount,
      share: shareOf(group.amount),
      avg6:
        input.averageMonths > 0
          ? (averageTotals.get(groupId) ?? 0) / input.averageMonths
          : null,
      categoryIds: [...group.categoryIds].sort((a, b) => a - b),
      children,
    });
  }
  groups.sort((a, b) => b.amount - a.amount);

  return {
    month: input.month,
    isCurrentMonth: input.isCurrentMonth,
    total,
    averageMonths: input.averageMonths,
    groups,
  };
}

/** Keeps the largest groups and folds the rest into one "Other" slice. */
export function foldBreakdownForDonut(
  groups: HomeCategoryBreakdownGroup[],
  maxSlices: number
): DonutSlice[] {
  const slices: DonutSlice[] = groups.map((group) => ({
    key: group.categoryId == null ? "uncategorized" : `c${group.categoryId}`,
    categoryId: group.categoryId,
    name: group.name,
    color: group.color,
    amount: group.amount,
    share: group.share,
    isOther: false,
  }));
  if (slices.length <= maxSlices) return slices;

  const kept = slices.slice(0, maxSlices - 1);
  const rest = slices.slice(maxSlices - 1);
  return [
    ...kept,
    {
      key: "other",
      categoryId: null,
      name: null,
      color: null,
      amount: rest.reduce((sum, slice) => sum + slice.amount, 0),
      share: rest.reduce((sum, slice) => sum + slice.share, 0),
      isOther: true,
    },
  ];
}

export function categoryDeltaVsAverage(
  amount: number,
  avg6: number | null
): number | null {
  if (avg6 == null || avg6 <= 0) return null;
  return ((amount - avg6) / avg6) * 100;
}
