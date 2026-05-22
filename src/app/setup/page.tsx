import { redirect } from "next/navigation";
import { getDb } from "@/server/db/index";
import { getGlobalSetting } from "@/server/db/queries/settings";
import { SetupWizard } from "@/components/setup/setup-wizard";
import { ENABLE_SCRAPER_SYNC } from "@/lib/features";

export const dynamic = "force-dynamic";

interface SetupPageProps {
  searchParams: Promise<{ force?: string; mode?: string }>;
}

function anyWorkspaceConfigured(): boolean {
  if (!ENABLE_SCRAPER_SYNC) {
    return getGlobalSetting("ai_provider") !== null;
  }
  const table = ENABLE_SCRAPER_SYNC ? "bank_credentials" : "import_sources";
  const row = getDb()
    .prepare(`SELECT COUNT(*) as count FROM ${table}`)
    .get() as { count: number };
  return row.count > 0;
}

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const { force, mode } = await searchParams;

  const newWorkspaceMode = mode === "new-workspace";

  if (!newWorkspaceMode && force !== "1" && anyWorkspaceConfigured()) {
    redirect("/");
  }

  return <SetupWizard mode={newWorkspaceMode ? "new-workspace" : "first-run"} />;
}
