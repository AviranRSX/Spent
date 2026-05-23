import "server-only";

import { getDb } from "@/server/db/index";
import { hasBankCredentials } from "@/server/db/queries/bank-credentials";
import {
  getDataSourceMode,
  getGlobalSetting,
} from "@/server/db/queries/settings";
import { canOpenMainApp } from "@/lib/settings-visibility";
import type { DataSourceMode } from "@/lib/types";

interface SetupAccessStatus {
  workspaceId: number;
  dataSourceMode: DataSourceMode | null;
  hasBankCredentials: boolean;
  hasAIChoice: boolean;
}

export function getDefaultWorkspaceId(): number {
  const row = getDb()
    .prepare("SELECT id FROM workspaces ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined;
  if (!row) {
    throw new Error("No workspace exists. Migration 013_workspaces did not run.");
  }
  return row.id;
}

export function getSetupAccessStatus(
  workspaceId = getDefaultWorkspaceId()
): SetupAccessStatus {
  return {
    workspaceId,
    dataSourceMode: getDataSourceMode(workspaceId),
    hasBankCredentials: hasBankCredentials(workspaceId),
    hasAIChoice: getGlobalSetting("ai_provider") !== null,
  };
}

export function canOpenDefaultWorkspace(): boolean {
  const status = getSetupAccessStatus();
  return canOpenMainApp(status);
}

export function canOpenAnyWorkspace(): boolean {
  return getFirstOpenWorkspaceStatus() !== null;
}

export function getFirstOpenWorkspaceStatus(): SetupAccessStatus | null {
  const rows = getDb()
    .prepare("SELECT id FROM workspaces ORDER BY id")
    .all() as { id: number }[];
  for (const row of rows) {
    const status = getSetupAccessStatus(row.id);
    if (canOpenMainApp(status)) return status;
  }
  return null;
}
