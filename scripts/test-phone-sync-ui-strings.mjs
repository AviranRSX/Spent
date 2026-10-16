import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const en = JSON.parse(readFileSync("src/i18n/messages/en.json", "utf8"));
const he = JSON.parse(readFileSync("src/i18n/messages/he.json", "utf8"));

test("phone budget stat in the budget sheet uses translated strings", () => {
  const source = readFileSync("src/components/dashboard/budget-detail-sheet.tsx", "utf8");
  const start = source.indexOf("{IS_MOBILE ? (");
  assert.ok(start >= 0, "phone branch of the budget stat");
  const block = source.slice(start, source.indexOf("<BudgetStat", start));
  assert.doesNotMatch(block, /label="Budget"/);
  assert.doesNotMatch(block, /"auto"/);
  for (const key of ["detailBudgetLabel", "detailAutoBudget"]) {
    assert.match(block, new RegExp(`t\\("${key}"\\)`));
    assert.ok(en.dashboard[key], `en dashboard.${key}`);
    assert.ok(he.dashboard[key], `he dashboard.${key}`);
    assert.notEqual(he.dashboard[key], en.dashboard[key]);
  }
});
