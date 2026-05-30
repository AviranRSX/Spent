"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, InputGroup } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SectionShell, SettingCard } from "@/components/settings/section-shell";
import {
  applyBudgetSuggestions,
  getBudgets,
  getBudgetSuggestions,
  getCategories,
  getSettings,
  type BudgetSuggestion,
  type BudgetSuggestionsResponse,
} from "@/lib/api";
import type { Budget, Category } from "@/lib/types";

interface ReviewRow {
  categoryId: number;
  categoryName: string;
  color: string;
  currentBudget: number;
  mean: number;
  median: number;
  suggestedBudget: number;
}

export default function CategoryStatisticsPage() {
  const router = useRouter();
  const [monthCount, setMonthCount] = useState(3);
  const suggestionsQuery = useQuery({
    queryKey: ["budget-suggestions", monthCount],
    queryFn: () => getBudgetSuggestions(monthCount),
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories", "expense"],
    queryFn: () => getCategories("expense"),
  });
  const { data: budgets = [] } = useQuery({
    queryKey: ["budgets"],
    queryFn: getBudgets,
  });
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  });

  const data = suggestionsQuery.data;
  const maxMonthCount = Math.max(data?.maxMonthCount ?? 3, 3);
  const minMonthCount = data?.minMonthCount ?? 3;

  return (
    <SectionShell
      title="Budget statistics"
      description="Compare current budgets with completed-month statistics before saving changes."
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/settings/categories")}
          className="gap-1.5"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Categories
        </Button>
        <div className="flex items-end gap-2">
          <div className="w-36 space-y-1.5">
            <Label htmlFor="statistics-month-count">Months</Label>
            <Input
              id="statistics-month-count"
              type="number"
              min={minMonthCount}
              max={maxMonthCount}
              value={monthCount}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (!Number.isFinite(parsed)) return;
                setMonthCount(
                  Math.min(Math.max(Math.floor(parsed), minMonthCount), maxMonthCount)
                );
              }}
            />
          </div>
          <Badge variant="outline">
            {data ? `${data.months.join(", ")}` : "Loading"}
          </Badge>
        </div>
      </div>

      {suggestionsQuery.isLoading ? (
        <SettingCard>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Calculating statistics...
          </div>
        </SettingCard>
      ) : data && !data.hasEnoughHistory ? (
        <SettingCard>
          <div className="text-sm text-muted-foreground">{data.message}</div>
        </SettingCard>
      ) : data ? (
        <StatisticsEditor
          key={`${data.selectedMonthCount}:${data.categorySuggestions.map((row) => row.categoryId).join(",")}`}
          data={data}
          categories={categories}
          budgets={budgets}
          currentMonthlyTarget={settings?.monthlyTarget ?? null}
        />
      ) : null}
    </SectionShell>
  );
}

function StatisticsEditor({
  data,
  categories,
  budgets,
  currentMonthlyTarget,
}: {
  data: BudgetSuggestionsResponse;
  categories: Category[];
  budgets: Budget[];
  currentMonthlyTarget: number | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const rows = useMemo(
    () => buildReviewRows(data.categorySuggestions, categories, budgets),
    [data.categorySuggestions, categories, budgets]
  );
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      rows.map((row) => [row.categoryId, String(Math.round(row.suggestedBudget))])
    )
  );
  const [targetValue, setTargetValue] = useState(() =>
    data.totalBudgetSuggestion?.suggestedBudget != null
      ? String(Math.round(data.totalBudgetSuggestion.suggestedBudget))
      : currentMonthlyTarget != null
        ? String(Math.round(currentMonthlyTarget))
        : ""
  );

  const mutation = useMutation({
    mutationFn: () =>
      applyBudgetSuggestions({
        categoryBudgets: rows.map((row) => ({
          categoryId: row.categoryId,
          amount: Number(values[row.categoryId] ?? "0"),
        })),
        monthlyTarget:
          targetValue.trim() === "" ? null : Number(targetValue.trim()),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success(`Saved ${result.appliedCategoryCount} budget choices`);
      router.push("/settings/categories");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Could not save budget choices");
    },
  });

  const allValuesValid =
    rows.every((row) => isValidBudgetValue(values[row.categoryId] ?? "")) &&
    (targetValue.trim() === "" || isValidBudgetValue(targetValue));

  return (
    <>
      <SettingCard
        title="Monthly target"
        description="The total recommendation uses bank-account expense history when available."
      >
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_180px] md:items-end">
          <Metric label="Current" value={currentMonthlyTarget} />
          <Metric
            label="Mean"
            value={data.totalBudgetSuggestion?.mean ?? null}
          />
          <div className="space-y-1.5">
            <Label htmlFor="monthly-target-choice">New target</Label>
            <InputGroup prefix="₪">
              <Input
                id="monthly-target-choice"
                type="number"
                min={0}
                step={1}
                value={targetValue}
                onChange={(event) => setTargetValue(event.target.value)}
                className="text-end tabular-nums"
              />
            </InputGroup>
          </div>
        </div>
      </SettingCard>

      <SettingCard>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-medium">Category budgets</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick the mean, median, current budget, or type a custom value.
            </p>
          </div>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!allValuesValid || mutation.isPending || rows.length === 0}
            className="gap-1.5"
          >
            {mutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {mutation.isPending ? "Saving..." : "Apply budgets"}
          </Button>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No category statistics found for the selected months.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="text-end">Current</TableHead>
                <TableHead className="text-end">Mean</TableHead>
                <TableHead className="text-end">Median</TableHead>
                <TableHead className="w-[180px] text-end">New budget</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.categoryId}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: row.color }}
                      />
                      <span className="font-medium">{row.categoryName}</span>
                    </div>
                  </TableCell>
                  <BudgetChoiceCell
                    value={row.currentBudget}
                    onClick={() =>
                      setValues((prev) => ({
                        ...prev,
                        [row.categoryId]: String(Math.round(row.currentBudget)),
                      }))
                    }
                  />
                  <BudgetChoiceCell
                    value={row.mean}
                    onClick={() =>
                      setValues((prev) => ({
                        ...prev,
                        [row.categoryId]: String(Math.round(row.mean)),
                      }))
                    }
                  />
                  <BudgetChoiceCell
                    value={row.median}
                    onClick={() =>
                      setValues((prev) => ({
                        ...prev,
                        [row.categoryId]: String(Math.round(row.median)),
                      }))
                    }
                  />
                  <TableCell>
                    <InputGroup prefix="₪">
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={values[row.categoryId] ?? ""}
                        onChange={(event) =>
                          setValues((prev) => ({
                            ...prev,
                            [row.categoryId]: event.target.value,
                          }))
                        }
                        className="text-end tabular-nums"
                      />
                    </InputGroup>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SettingCard>
    </>
  );
}

function BudgetChoiceCell({
  value,
  onClick,
}: {
  value: number;
  onClick: () => void;
}) {
  return (
    <TableCell className="text-end">
      <button
        type="button"
        onClick={onClick}
        className="rounded-md px-2 py-1 text-xs tabular-nums text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {formatIls(value)}
      </button>
    </TableCell>
  );
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">
        {value == null ? "No value" : formatIls(value)}
      </div>
    </div>
  );
}

function buildReviewRows(
  suggestions: BudgetSuggestion[],
  categories: Category[],
  budgets: Budget[]
): ReviewRow[] {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const budgetByCategoryId = new Map(
    budgets.map((budget) => [budget.categoryId, budget.monthlyAmount])
  );
  return suggestions.map((suggestion) => {
    const category = categoryById.get(suggestion.categoryId);
    return {
      categoryId: suggestion.categoryId,
      categoryName: category?.name ?? suggestion.categoryName,
      color: category?.color ?? "#9ca3af",
      currentBudget: budgetByCategoryId.get(suggestion.categoryId) ?? 0,
      mean: suggestion.mean,
      median: suggestion.median,
      suggestedBudget: suggestion.suggestedBudget,
    };
  });
}

function isValidBudgetValue(value: string): boolean {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0;
}

function formatIls(value: number): string {
  return `₪${Math.round(value).toLocaleString("en-IL")}`;
}
