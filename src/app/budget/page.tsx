import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Dashboard } from "@/components/dashboard/dashboard";
import { getDb } from "@/server/db/index";
import { getGlobalSetting } from "@/server/db/queries/settings";
import { ENABLE_SCRAPER_SYNC } from "@/lib/features";
import { canOpenMainApp } from "@/lib/settings-visibility";

export const dynamic = "force-dynamic";

function canOpenBudget(): boolean {
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM bank_credentials")
    .get() as { count: number };
  return canOpenMainApp({
    scraperSyncEnabled: ENABLE_SCRAPER_SYNC,
    hasBankCredentials: row.count > 0,
    hasAIChoice: getGlobalSetting("ai_provider") !== null,
  });
}

export default function BudgetPage() {
  if (!canOpenBudget()) {
    redirect("/setup");
  }

  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}
