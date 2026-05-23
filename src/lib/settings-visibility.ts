import type { DataSourceMode } from "@/lib/types";

interface SetupModeStatus {
  dataSourceMode: DataSourceMode | null;
  hasBankCredentials: boolean;
  hasImportSources: boolean;
}

interface MainAppAccessStatus {
  dataSourceMode: DataSourceMode | null;
  hasBankCredentials: boolean;
  hasAIChoice: boolean;
}

export function shouldShowScraperSyncSettings(
  status: SetupModeStatus
): boolean {
  return status.dataSourceMode === "scraper" && status.hasBankCredentials;
}

export function canOpenMainApp(status: MainAppAccessStatus): boolean {
  if (status.dataSourceMode === "scraper") {
    return status.hasBankCredentials;
  }
  if (status.dataSourceMode === "xlsx") {
    return true;
  }
  return false;
}
