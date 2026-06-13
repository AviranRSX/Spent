import assert from "node:assert/strict";
import test from "node:test";

const visibility = await import("../src/lib/settings-visibility.ts");

test("shows scraper sync settings only when scraper mode has bank credentials", () => {
  assert.equal(
    visibility.shouldShowScraperSyncSettings({
      dataSourceMode: "scraper",
      hasBankCredentials: true,
      hasImportSources: false,
    }),
    true
  );
  assert.equal(
    visibility.shouldShowScraperSyncSettings({
      dataSourceMode: "scraper",
      hasBankCredentials: true,
      hasImportSources: true,
    }),
    true
  );
  assert.equal(
    visibility.shouldShowScraperSyncSettings({
      dataSourceMode: "xlsx",
      hasBankCredentials: true,
      hasImportSources: false,
    }),
    false
  );
  assert.equal(
    visibility.shouldShowScraperSyncSettings({
      dataSourceMode: "xlsx",
      hasBankCredentials: false,
      hasImportSources: true,
    }),
    false
  );
});

test("allows main app navigation after choosing XLSX mode without bank credentials", () => {
  assert.equal(
    visibility.canOpenMainApp({
      dataSourceMode: "xlsx",
      hasBankCredentials: false,
      hasAIChoice: true,
    }),
    true
  );
  assert.equal(
    visibility.canOpenMainApp({
      dataSourceMode: "scraper",
      hasBankCredentials: false,
      hasAIChoice: true,
    }),
    false
  );
});

test("keeps first-run setup open until a data source mode is selected", () => {
  assert.equal(
    visibility.canOpenMainApp({
      dataSourceMode: null,
      hasBankCredentials: true,
      hasAIChoice: true,
    }),
    false
  );
  assert.equal(
    visibility.canOpenMainApp({
      dataSourceMode: null,
      hasBankCredentials: false,
      hasAIChoice: true,
    }),
    false
  );
});
