import { redirect } from "next/navigation";
import { getDb } from "@/server/db/index";
import { AppShell } from "@/components/layout/app-shell";
import { TransactionsPage } from "@/components/transactions/transactions-page";
import { getGlobalSetting } from "@/server/db/queries/settings";
import { ENABLE_SCRAPER_SYNC } from "@/lib/features";
import { canOpenMainApp } from "@/lib/settings-visibility";

export const dynamic = "force-dynamic";

function canOpenTransactions(): boolean {
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM bank_credentials")
    .get() as { count: number };
  return canOpenMainApp({
    scraperSyncEnabled: ENABLE_SCRAPER_SYNC,
    hasBankCredentials: row.count > 0,
    hasAIChoice: getGlobalSetting("ai_provider") !== null,
  });
}

export default function Transactions() {
  if (!canOpenTransactions()) {
    redirect("/setup");
  }
  return (
    <AppShell>
      <TransactionsPage />
    </AppShell>
  );
}
