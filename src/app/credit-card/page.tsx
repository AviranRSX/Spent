import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { CreditCardPage } from "@/components/credit-card/credit-card-page";
import { getDb } from "@/server/db/index";
import { getGlobalSetting } from "@/server/db/queries/settings";
import { ENABLE_SCRAPER_SYNC } from "@/lib/features";
import { canOpenMainApp } from "@/lib/settings-visibility";

export const dynamic = "force-dynamic";

function canOpenCreditCard(): boolean {
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM bank_credentials")
    .get() as { count: number };
  return canOpenMainApp({
    scraperSyncEnabled: ENABLE_SCRAPER_SYNC,
    hasBankCredentials: row.count > 0,
    hasAIChoice: getGlobalSetting("ai_provider") !== null,
  });
}

export default function CreditCard() {
  if (!canOpenCreditCard()) {
    redirect("/setup");
  }

  return (
    <AppShell>
      <CreditCardPage />
    </AppShell>
  );
}
