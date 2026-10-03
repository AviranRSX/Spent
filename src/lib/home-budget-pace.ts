export interface BudgetPaceMessage {
  key:
    | "spentThisMonth"
    | "spentInMonth"
    | "verdictOver"
    | "verdictABitOver"
    | "verdictAhead"
    | "verdictOnSchedule"
    | "verdictFinishedOver"
    | "verdictFinishedUnder";
  amount: number | null;
  tone: "neutral" | "good" | "bad";
}

/**
 * The verdict under the spent figure. Current-month thresholds match the
 * previous this-month card: 20+ points ahead of time is "a bit over",
 * 10+ points behind is "ahead". Past months get a final verdict instead.
 */
export function budgetPaceMessage(input: {
  spent: number;
  budget: number;
  timeElapsedPercent: number;
  isPast: boolean;
}): BudgetPaceMessage {
  const { spent, budget, timeElapsedPercent, isPast } = input;
  if (budget <= 0) {
    return { key: isPast ? "spentInMonth" : "spentThisMonth", amount: null, tone: "neutral" };
  }
  if (isPast) {
    return spent > budget
      ? { key: "verdictFinishedOver", amount: spent - budget, tone: "bad" }
      : { key: "verdictFinishedUnder", amount: budget - spent, tone: "good" };
  }
  const pctSpent = (spent / budget) * 100;
  if (pctSpent > 100) {
    return { key: "verdictOver", amount: spent - budget, tone: "bad" };
  }
  const delta = pctSpent - timeElapsedPercent;
  if (delta >= 20) return { key: "verdictABitOver", amount: null, tone: "bad" };
  if (delta <= -10) return { key: "verdictAhead", amount: null, tone: "good" };
  return { key: "verdictOnSchedule", amount: null, tone: "good" };
}
