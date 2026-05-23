import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { HomePage } from "@/components/home/home-page";
import {
  canOpenAnyWorkspace,
  getFirstOpenWorkspaceStatus,
} from "@/server/setup/access";

export const dynamic = "force-dynamic";

export default function Home() {
  if (!canOpenAnyWorkspace()) {
    redirect("/setup");
  }
  const dataSourceMode = getFirstOpenWorkspaceStatus()?.dataSourceMode ?? "xlsx";

  return (
    <AppShell>
      <HomePage dataSourceMode={dataSourceMode} />
    </AppShell>
  );
}
