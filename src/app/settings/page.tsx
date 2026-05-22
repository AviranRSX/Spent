import { redirect } from "next/navigation";
import { getDb } from "@/server/db/index";
import { getGlobalSetting } from "@/server/db/queries/settings";
import { ENABLE_SCRAPER_SYNC } from "@/lib/features";
import { canOpenMainApp } from "@/lib/settings-visibility";

export const dynamic = "force-dynamic";

function canOpenSettings(): boolean {
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM bank_credentials")
    .get() as { count: number };
  return canOpenMainApp({
    scraperSyncEnabled: ENABLE_SCRAPER_SYNC,
    hasBankCredentials: row.count > 0,
    hasAIChoice: getGlobalSetting("ai_provider") !== null,
  });
}

export default function SettingsRoot() {
  if (!canOpenSettings()) {
    redirect("/setup");
  }
  redirect("/settings/general");
}
