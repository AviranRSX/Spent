"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { BankStep } from "@/components/setup/bank-step";
import { AIStep } from "@/components/setup/ai-step";
import { MonthlyTargetStep } from "@/components/setup/monthly-target-step";
import { BudgetsStep } from "@/components/setup/budgets-step";
import { CompleteStep } from "@/components/setup/complete-step";
import { WorkspaceNameStep } from "@/components/setup/workspace-name-step";
import { DataSourceStep } from "@/components/setup/data-source-step";
import { SetupImportStep } from "@/components/setup/setup-import-step";
import {
  BudgetSuggestionsStep,
  type SetupBudgetDefaults,
} from "@/components/setup/budget-suggestions-step";
import { createWorkspace, saveDataSourceMode } from "@/lib/api";
import {
  getStepAfterXlsxImport,
  getStepBeforeBudgetSuggestions,
  getVisibleSetupSteps,
  type SetupMode,
  type WizardStep,
} from "@/lib/setup/wizard-flow";
import { setActiveWorkspaceId } from "@/lib/workspace-store";
import { useQueryClient } from "@tanstack/react-query";
import type { DataSourceMode } from "@/lib/types";

export function SetupWizard({
  mode = "first-run",
  initialDataSourceMode = null,
}: {
  mode?: SetupMode;
  initialDataSourceMode?: DataSourceMode | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dataSourceMode, setDataSourceMode] =
    useState<DataSourceMode | null>(initialDataSourceMode);
  const [step, setStep] = useState<WizardStep>(
    mode === "new-workspace"
      ? 0
      : initialDataSourceMode === "scraper"
        ? 1
        : initialDataSourceMode === "xlsx"
          ? 2
          : 6
  );
  const [creating, setCreating] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [budgetDefaults, setBudgetDefaults] =
    useState<SetupBudgetDefaults | null>(null);

  const steps = getVisibleSetupSteps(mode, dataSourceMode);

  async function handleNameSubmit(name: string) {
    setCreating(true);
    try {
      const ws = await createWorkspace(name);
      setActiveWorkspaceId(ws.id);
      queryClient.invalidateQueries();
      setStep(6);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create workspace"
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleDataSourceSelect(nextMode: DataSourceMode) {
    setSavingMode(true);
    try {
      await saveDataSourceMode(nextMode);
      setDataSourceMode(nextMode);
      setBudgetDefaults(null);
      await queryClient.invalidateQueries({ queryKey: ["setup-status"] });
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      setStep(nextMode === "scraper" ? 1 : 2);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save data source"
      );
    } finally {
      setSavingMode(false);
    }
  }

  function handleFinish() {
    queryClient.invalidateQueries();
    router.push(dataSourceMode === "scraper" ? "/?sync=1" : "/");
  }

  return (
    <div className="relative min-h-screen bg-background">
      <header className="relative z-10 mx-auto flex max-w-5xl items-center justify-between gap-6 px-6 py-6 md:px-8">
        <BrandMark />
        <DotStepper step={step} steps={steps} />
        <a
          href="https://github.com/Shaya16/Spent"
          target="_blank"
          rel="noreferrer"
          className="hidden text-xs text-muted-foreground hover:text-foreground md:inline"
        >
          Docs ↗
        </a>
      </header>

      <main className="relative z-10 mx-auto px-6 pb-16 md:px-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.2, 0.7, 0.3, 1] }}
          >
            {step === 0 && (
              <WorkspaceNameStep
                onComplete={handleNameSubmit}
                submitting={creating}
              />
            )}
            {step === 6 && (
              <DataSourceStep
                onSelect={handleDataSourceSelect}
                submitting={savingMode}
              />
            )}
            {step === 1 && (
              dataSourceMode === "scraper" ? (
                <BankStep
                  onComplete={() =>
                    setStep(mode === "new-workspace" ? 5 : 2)
                  }
                />
              ) : null
            )}
            {step === 2 && (
              <AIStep
                onComplete={() =>
                  setStep(dataSourceMode === "xlsx" ? 7 : 5)
                }
                onBack={() =>
                  setStep(dataSourceMode === "scraper" ? 1 : 6)
                }
              />
            )}
            {step === 7 && (
              <SetupImportStep
                onImported={() => {
                  setStep(getStepAfterXlsxImport());
                }}
                onSkip={() => {
                  setStep(9);
                }}
                onBack={() => setStep(2)}
              />
            )}
            {step === 9 && (
              <BudgetSuggestionsStep
                onComplete={(defaults) => {
                  setBudgetDefaults(defaults);
                  setStep(5);
                }}
                onBack={() =>
                  setStep(getStepBeforeBudgetSuggestions(dataSourceMode))
                }
              />
            )}
            {step === 5 && (
              <MonthlyTargetStep
                onComplete={() => setStep(3)}
                initialValue={budgetDefaults?.monthlyTarget ?? null}
                onBack={() =>
                  setStep(
                    dataSourceMode === "xlsx"
                      ? 9
                      : mode === "new-workspace"
                        ? 1
                        : 2
                  )
                }
              />
            )}
            {step === 3 && (
              <BudgetsStep
                onComplete={() => setStep(4)}
                onBack={() => setStep(5)}
                initialAmounts={budgetDefaults?.categoryBudgets}
              />
            )}
            {step === 4 && (
              <CompleteStep
                dataSourceMode={dataSourceMode ?? "xlsx"}
                onFinish={handleFinish}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <img
        src="/logo_lightmode.svg"
        alt="Spent"
        className="h-8 w-auto dark:hidden"
      />
      <img
        src="/logo_darkmode.svg"
        alt="Spent"
        className="hidden h-8 w-auto dark:block"
      />
      <div>
        <div className="font-serif text-lg font-semibold leading-none tracking-tight">
          Spent
        </div>
        <div className="mt-1 text-[8px] font-bold tracking-[0.18em] text-muted-foreground">
          YOUR MONEY · OPEN SOURCE
        </div>
      </div>
    </div>
  );
}

interface StepDef {
  n: WizardStep;
  label: string;
}

function DotStepper({
  step,
  steps,
}: {
  step: WizardStep;
  steps: ReadonlyArray<StepDef>;
}) {
  const currentIdx = steps.findIndex((s) => s.n === step);
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => {
        const state =
          i < currentIdx ? "done" : i === currentIdx ? "active" : "todo";
        return (
          <div key={s.n} className="flex items-center gap-2">
            <DotLabel label={s.label} state={state} />
            {i < steps.length - 1 && (
              <motion.div
                animate={{
                  background:
                    i < currentIdx
                      ? "var(--primary)"
                      : "var(--border)",
                }}
                transition={{ duration: 0.35 }}
                className="h-px w-3.5 rounded-full"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function DotLabel({
  label,
  state,
}: {
  label: string;
  state: "todo" | "active" | "done";
}) {
  return (
    <div className="flex items-center gap-1.5">
      <motion.div
        animate={{
          background:
            state === "active"
              ? "var(--foreground)"
              : state === "done"
                ? "var(--primary)"
                : "var(--border)",
          scale: state === "active" ? 1.4 : 1,
        }}
        transition={{ duration: 0.25 }}
        className="h-1.5 w-1.5 rounded-full"
      />
      <span
        className={`text-[9px] font-bold uppercase tracking-[0.14em] transition-colors ${
          state === "active"
            ? "text-foreground"
            : state === "done"
              ? "text-primary"
              : "text-muted-foreground/60"
        }`}
      >
        {label}
      </span>
    </div>
  );
}
