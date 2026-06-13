import assert from "node:assert/strict";
import test from "node:test";

import {
  getImportTemplateDefinition,
  getImportTemplateLabel,
  getImportTemplatesForKind,
  IMPORT_WORKBOOK_ACCEPT,
  IMPORT_TEMPLATE_DEFINITIONS,
  templateMatchesSourceKind,
} from "../src/lib/imports/templates.js";

test("groups import templates by source kind", () => {
  assert.deepEqual(
    getImportTemplatesForKind("card").map((template) => template.name),
    ["Max", "Isracard", "CAL"]
  );
  assert.deepEqual(
    getImportTemplatesForKind("bank").map((template) => template.name),
    ["Hapoalim", "Leumi"]
  );
});

test("defines labels for every supported import template", () => {
  assert.deepEqual(
    IMPORT_TEMPLATE_DEFINITIONS.map((template) => template.templateType).sort(),
    [
      "cal_bill",
      "hapoalim_bank_account",
      "isracard_bill",
      "leumi_bank_account",
      "max_bill",
    ].sort()
  );
  assert.equal(
    getImportTemplateDefinition("cal_bill")?.sampleFile,
    "cal_inbar_may.xlsx"
  );
  assert.equal(
    getImportTemplateDefinition("max_bill")?.sampleFile,
    "max_aviran.xlsx"
  );
  assert.equal(
    getImportTemplateDefinition("isracard_bill")?.sampleFile,
    "isracard_aviran.xlsx"
  );
  assert.equal(
    getImportTemplateDefinition("hapoalim_bank_account")?.sampleFile,
    "hapoalim_bank.xlsx"
  );
  assert.equal(
    getImportTemplateDefinition("leumi_bank_account")?.sampleFile,
    "leumi_bank.xls"
  );
});

test("validates source kind and template pairs for direct file imports", () => {
  assert.equal(templateMatchesSourceKind("max_bill", "card"), true);
  assert.equal(templateMatchesSourceKind("isracard_bill", "card"), true);
  assert.equal(templateMatchesSourceKind("cal_bill", "card"), true);
  assert.equal(templateMatchesSourceKind("hapoalim_bank_account", "bank"), true);
  assert.equal(templateMatchesSourceKind("leumi_bank_account", "bank"), true);
  assert.equal(templateMatchesSourceKind("max_bill", "bank"), false);
  assert.equal(templateMatchesSourceKind("cal_bill", "bank"), false);
  assert.equal(templateMatchesSourceKind("hapoalim_bank_account", "card"), false);
  assert.equal(templateMatchesSourceKind("leumi_bank_account", "card"), false);
  assert.equal(getImportTemplateLabel("max_bill"), "Max");
  assert.equal(getImportTemplateLabel("cal_bill"), "CAL");
  assert.equal(getImportTemplateLabel("leumi_bank_account"), "Leumi");
});

test("accepts both XLS and XLSX files for workbook imports", () => {
  assert.equal(IMPORT_WORKBOOK_ACCEPT.includes(".xls"), true);
  assert.equal(IMPORT_WORKBOOK_ACCEPT.includes(".xlsx"), true);
});
