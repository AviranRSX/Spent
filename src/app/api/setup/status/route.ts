import { NextResponse } from "next/server";
import { hasBankCredentials } from "@/server/db/queries/bank-credentials";
import { hasImportSources } from "@/server/db/queries/import-sources";
import {
  getDataSourceMode,
  getGlobalSetting,
} from "@/server/db/queries/settings";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { canOpenMainApp } from "@/lib/settings-visibility";

export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const hasBank = hasBankCredentials(workspaceId);
  const hasSources = hasImportSources(workspaceId);
  const dataSourceMode = getDataSourceMode(workspaceId);
  const aiProvider = getGlobalSetting("ai_provider");
  const hasAIChoice = aiProvider !== null;
  const hasAI = hasAIChoice && aiProvider !== "none";

  return NextResponse.json({
    isConfigured: canOpenMainApp({
      dataSourceMode,
      hasBankCredentials: hasBank,
      hasAIChoice,
    }),
    dataSourceMode,
    hasBankCredentials: hasBank,
    hasImportSources: hasSources,
    hasAIProvider: hasAI,
  });
}
