import assert from "node:assert/strict";
import test from "node:test";

import {
  getImportTemplateDefinition,
  getImportTemplateLabel,
  getImportTemplatesForKind,
  IMPORT_TEMPLATE_DEFINITIONS,
  templateMatchesSourceKind,
} from "../src/lib/imports/templates.js";

test("groups import templates by source kind", () => {
  assert.deepEqual(
    getImportTemplatesForKind("card").map((template) => template.name),
    ["Max", "Isracard"]
  );
  assert.deepEqual(
    getImportTemplatesForKind("bank").map((template) => template.name),
    ["Hapoalim"]
  );
});

test("defines labels for every supported import template", () => {
  assert.deepEqual(
    IMPORT_TEMPLATE_DEFINITIONS.map((template) => template.templateType).sort(),
    ["bank_account", "credit_card_export", "isracard_bill"].sort()
  );
  assert.equal(
    getImportTemplateDefinition("credit_card_export")?.sampleFile,
    "transaction-details_export_1779464233227.xlsx"
  );
  assert.equal(
    getImportTemplateDefinition("isracard_bill")?.sampleFile,
    "2437_05_2026.xlsx"
  );
  assert.equal(
    getImportTemplateDefinition("bank_account")?.sampleFile,
    "excelNewTransactions.xlsx"
  );
});

test("validates source kind and template pairs for direct file imports", () => {
  assert.equal(templateMatchesSourceKind("credit_card_export", "card"), true);
  assert.equal(templateMatchesSourceKind("isracard_bill", "card"), true);
  assert.equal(templateMatchesSourceKind("bank_account", "bank"), true);
  assert.equal(templateMatchesSourceKind("credit_card_export", "bank"), false);
  assert.equal(templateMatchesSourceKind("bank_account", "card"), false);
  assert.equal(getImportTemplateLabel("credit_card_export"), "Max");
});
