"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getBudgetSuggestions,
  type BudgetSuggestionsResponse,
} from "@/lib/api";

export interface SetupBudgetDefaults {
  monthlyTarget: number | null;
  categoryBudgets: Map<number, number>;
}

interface BudgetSuggestionsStepProps {
  onComplete: (defaults: SetupBudgetDefaults | null) => void;
  onBack: () => void;
}

export function BudgetSuggestionsStep({
  onComplete,
  onBack,
}: BudgetSuggestionsStepProps) {
  const [data, setData] = useState<BudgetSuggestionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [monthCount, setMonthCount] = useState(3);

  useEffect(() => {
    let cancelled = false;
    getBudgetSuggestions(monthCount)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setMonthCount(result.selectedMonthCount);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [monthCount]);

  function useSuggestions() {
    if (!data || !data.hasEnoughHistory) {
      onComplete(null);
      return;
    }
    onComplete({
      monthlyTarget: data.totalBudgetSuggestion?.suggestedBudget ?? null,
      categoryBudgets: new Map(
        data.categorySuggestions.map((row) => [
          row.categoryId,
          row.suggestedBudget,
        ])
      ),
    });
  }

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-6">
      <header className="space-y-2">
        <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Step 5 of 7 · Statistics
        </div>
        <h1 className="font-serif text-4xl leading-[1.08] tracking-tight">
          Suggested budgets
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Suggestions use the mean of the selected complete months.
        </p>
      </header>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-[1fr_140px] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="statistics-months">Statistics months</Label>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Use at least 3 complete months, up to the history available in
              this workspace.
            </p>
          </div>
          <Input
            id="statistics-months"
            type="number"
            min={data?.minMonthCount ?? 3}
            max={Math.max(data?.maxMonthCount ?? 3, data?.minMonthCount ?? 3)}
            value={monthCount}
            disabled={loading || (data?.maxMonthCount ?? 3) < 3}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (!Number.isFinite(next)) return;
              const min = data?.minMonthCount ?? 3;
              const max = Math.max(data?.maxMonthCount ?? min, min);
              setLoading(true);
              setMonthCount(Math.min(Math.max(Math.floor(next), min), max));
            }}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        {loading ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Calculating budget suggestions...
          </div>
        ) : data && !data.hasEnoughHistory ? (
          <div className="text-sm text-muted-foreground">{data.message}</div>
        ) : data ? (
          <div className="space-y-5">
            <div className="flex items-start gap-3 rounded-xl bg-primary/10 p-4">
              <Sparkles className="mt-0.5 h-4 w-4 text-primary" />
              <div>
                <div className="text-sm font-medium">
                  Total monthly suggestion
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {data.totalBudgetSuggestion
                    ? `₪ ${data.totalBudgetSuggestion.suggestedBudget.toLocaleString()}`
                    : "No bank account history"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Months: {data.months.join(", ")}
                </div>
              </div>
            </div>

            <div className="max-h-72 overflow-auto rounded-xl border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Mean</th>
                    <th className="px-3 py-2">Median</th>
                    <th className="px-3 py-2">Suggested</th>
                  </tr>
                </thead>
                <tbody>
                  {data.categorySuggestions.map((row) => (
                    <tr key={row.categoryId} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">
                        {row.categoryName}
                      </td>
                      <td className="px-3 py-2">₪ {row.mean.toLocaleString()}</td>
                      <td className="px-3 py-2">
                        ₪ {row.median.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 font-semibold">
                        ₪ {row.suggestedBudget.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>

      <footer className="flex items-center justify-between pt-2">
        <Button variant="outline" onClick={onBack}>
          ← Back
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => onComplete(null)}>
            Skip suggestions
          </Button>
          <Button onClick={useSuggestions}>
            {data?.hasEnoughHistory ? "Use suggestions →" : "Continue →"}
          </Button>
        </div>
      </footer>
    </div>
  );
}
