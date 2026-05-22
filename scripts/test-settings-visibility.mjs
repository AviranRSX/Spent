import assert from "node:assert/strict";
import test from "node:test";

const visibility = await import("../src/lib/settings-visibility.ts");

test("shows scraper sync settings only when scraper bank credentials exist", () => {
  assert.equal(
    visibility.shouldShowScraperSyncSettings({
      hasBankCredentials: true,
      hasImportSources: false,
    }),
    true
  );
  assert.equal(
    visibility.shouldShowScraperSyncSettings({
      hasBankCredentials: true,
      hasImportSources: true,
    }),
    true
  );
  assert.equal(
    visibility.shouldShowScraperSyncSettings({
      hasBankCredentials: false,
      hasImportSources: true,
    }),
    false
  );
});

test("allows main app navigation in XLSX mode after setup choice without bank credentials", () => {
  assert.equal(
    visibility.canOpenMainApp({
      scraperSyncEnabled: false,
      hasBankCredentials: false,
      hasAIChoice: true,
    }),
    true
  );
  assert.equal(
    visibility.canOpenMainApp({
      scraperSyncEnabled: true,
      hasBankCredentials: false,
      hasAIChoice: true,
    }),
    false
  );
});
