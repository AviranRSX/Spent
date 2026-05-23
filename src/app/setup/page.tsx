import { redirect } from "next/navigation";
import { SetupWizard } from "@/components/setup/setup-wizard";
import {
  canOpenAnyWorkspace,
  getDefaultWorkspaceId,
  getSetupAccessStatus,
} from "@/server/setup/access";

export const dynamic = "force-dynamic";

interface SetupPageProps {
  searchParams: Promise<{ force?: string; mode?: string }>;
}

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const { force, mode } = await searchParams;

  const newWorkspaceMode = mode === "new-workspace";
  const workspaceId = getDefaultWorkspaceId();
  const status = getSetupAccessStatus(workspaceId);

  if (!newWorkspaceMode && force !== "1" && canOpenAnyWorkspace()) {
    redirect("/");
  }

  return (
    <SetupWizard
      mode={newWorkspaceMode ? "new-workspace" : "first-run"}
      initialDataSourceMode={
        newWorkspaceMode ? null : status.dataSourceMode
      }
    />
  );
}
