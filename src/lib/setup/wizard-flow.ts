import type { DataSourceMode } from "@/lib/types";

export type SetupMode = "first-run" | "new-workspace";

export type WizardStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface SetupStepDef {
  n: WizardStep;
  label: string;
}

export const FIRST_RUN_STEPS: SetupStepDef[] = [
  { n: 6, label: "Source" },
  { n: 1, label: "Connect" },
  { n: 2, label: "AI" },
  { n: 7, label: "Import" },
  { n: 8, label: "Review" },
  { n: 9, label: "Stats" },
  { n: 5, label: "Target" },
  { n: 3, label: "Budgets" },
  { n: 4, label: "Done" },
];

export const NEW_WORKSPACE_STEPS: SetupStepDef[] = [
  { n: 0, label: "Name" },
  { n: 6, label: "Source" },
  { n: 1, label: "Connect" },
  { n: 2, label: "AI" },
  { n: 7, label: "Import" },
  { n: 8, label: "Review" },
  { n: 9, label: "Stats" },
  { n: 5, label: "Target" },
  { n: 3, label: "Budgets" },
  { n: 4, label: "Done" },
];

export function getVisibleSetupSteps(
  mode: SetupMode,
  dataSourceMode: DataSourceMode | null
): SetupStepDef[] {
  const allSteps =
    mode === "new-workspace" ? NEW_WORKSPACE_STEPS : FIRST_RUN_STEPS;
  return allSteps.filter((step) => {
    if (dataSourceMode === "scraper") return ![7, 8, 9].includes(step.n);
    if (dataSourceMode === "xlsx") return ![1, 8].includes(step.n);
    return step.n === 0 || step.n === 6 || step.n === 4;
  });
}

export function getVisibleSetupStepNumbers(
  mode: SetupMode,
  dataSourceMode: DataSourceMode | null
): WizardStep[] {
  return getVisibleSetupSteps(mode, dataSourceMode).map((step) => step.n);
}

export function getStepAfterXlsxImport(): WizardStep {
  return 9;
}

export function getStepBeforeBudgetSuggestions(
  dataSourceMode: DataSourceMode | null
): WizardStep {
  return dataSourceMode === "xlsx" ? 7 : 2;
}

export function shouldShowSetupImportProgress(
  fileCount: number,
  rowCount: number
): boolean {
  return fileCount > 1 || rowCount > 10;
}
