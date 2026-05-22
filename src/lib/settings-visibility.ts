interface SetupModeStatus {
  hasBankCredentials: boolean;
  hasImportSources: boolean;
}

interface MainAppAccessStatus {
  scraperSyncEnabled: boolean;
  hasBankCredentials: boolean;
  hasAIChoice: boolean;
}

export function shouldShowScraperSyncSettings(
  status: SetupModeStatus
): boolean {
  return status.hasBankCredentials;
}

export function canOpenMainApp(status: MainAppAccessStatus): boolean {
  if (status.scraperSyncEnabled) {
    return status.hasBankCredentials;
  }
  return status.hasAIChoice;
}
