#!/usr/bin/env node
// Blocks commits that contain values from the household's real financial data.
//
// Fingerprints come from the real exports in /transactions/ and every SQLite
// database under /data/ (both gitignored). Matches are reported masked, so the
// hook never echoes a real value into a terminal, log, or agent transcript.
// Contributors without those folders get an instant pass.
//
// Usage:
//   node scripts/check-sensitive-data.mjs             scan staged changes (pre-commit)
//   node scripts/check-sensitive-data.mjs --message F scan a commit message file (commit-msg)
//   node scripts/check-sensitive-data.mjs --all       scan every tracked file
//
// Bypass a false positive for one commit with SPENT_ALLOW_SENSITIVE=1.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const transactionsDir = path.join(repo, "transactions");
const dataDir = path.join(repo, "data");

// Institution vocabulary that appears in every export and in the parsers.
const GENERIC_TEXT = new Set([
  "העברת משכורת", "הוראת קבע", "הוראת-קבע", "ל.מאסטרקרד(יש)", "כרטיסי אשראי-י",
  "משיכת מזומנים", "פירוט חיובים בבנק.xlsx", "excelNewTransactions.xlsx",
  "בנק הפועלים", "בנק לאומי",
]);
// Card memos are often "<transaction type> · <merchant category>", which is generic.
const CARD_TRANSACTION_TYPES = new Set(["רגילה", "הוראת קבע", "תשלומים", "קרדיט", "חיוב חודשי", "דחוי"]);
const SKIPPED_FILES = /(^|\/)(package-lock\.json|.*\.(png|jpe?g|gif|ico|webp|woff2?|ttf|db|xlsx?))$/i;

if (process.env.SPENT_ALLOW_SENSITIVE === "1") process.exit(0);

function listFiles(dir, predicate) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full, predicate);
    return predicate(entry.name) ? [full] : [];
  });
}

const exportFiles = listFiles(transactionsDir, (name) => /\.(xlsx?|csv|html?)$/i.test(name));
const databases = listFiles(dataDir, (name) => name.endsWith(".db"));
if (exportFiles.length === 0 && databases.length === 0) process.exit(0);

const fingerprints = new Map(); // value -> kind

function addText(value, kind, minLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length < minLength || GENERIC_TEXT.has(text) || !/[\p{L}\d]/u.test(text)) return;
  if (!fingerprints.has(text)) fingerprints.set(text, kind);
}

function addAmount(value) {
  const amount = Math.abs(Number(value));
  if (!Number.isFinite(amount)) return;
  const cents = Math.round(amount * 100) % 100 !== 0;
  // Non-round amounts are distinctive. Round ones only when large and odd, like a salary.
  if ((cents && amount >= 100) || (!cents && amount >= 1000 && amount % 10 !== 0)) {
    const text = String(Number(amount.toFixed(2)));
    if (!fingerprints.has(text)) fingerprints.set(text, "amount");
  }
}

function addTransaction(t) {
  addText(t.accountNumber ?? t.account_number, "account number", 6);
  addText(t.identifier, "transaction id", 6);
  addText(t.description, "description", 8);
  if (!CARD_TRANSACTION_TYPES.has(String(t.memo ?? "").split(" · ")[0].trim())) {
    addText(t.memo, "memo", 8);
  }
  addAmount(t.chargedAmount ?? t.charged_amount);
  addAmount(t.originalAmount ?? t.original_amount);
}

if (exportFiles.length > 0) {
  const { detectWorkbookBuffer, parseWorkbookBuffer } = require(
    path.join(repo, "src/lib/imports/xlsx-parser.js")
  );
  for (const file of exportFiles) {
    addText(path.basename(file), "export file name", 8);
    const buffer = fs.readFileSync(file);
    const detected = await detectWorkbookBuffer(buffer);
    if (!detected.ok) continue;
    const { transactions } = await parseWorkbookBuffer(buffer, {
      templateType: detected.templateType,
      sourceLabel: "",
    });
    transactions.forEach(addTransaction);
  }
}

if (databases.length > 0) {
  let Database = null;
  try {
    Database = require("better-sqlite3");
  } catch {
    // Native module unavailable; export fingerprints still apply.
  }
  for (const file of Database ? databases : []) {
    try {
      const db = new Database(file, { readonly: true, fileMustExist: true });
      db.prepare(
        "SELECT account_number, identifier, description, memo, charged_amount, original_amount FROM transactions"
      ).all().forEach(addTransaction);
      db.close();
    } catch {
      // Not a Spent database or locked; skip it.
    }
  }
}

const values = [...fingerprints.keys()];
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const numeric = new Map(
  values
    .filter((value) => fingerprints.get(value) === "amount")
    .map((value) => [value, new RegExp(`(?<![\\d.])${escape(value)}(?![\\d])`)])
);
const mask = (value) =>
  value.length <= 4 ? "****" : `${[...value].slice(0, 2).join("")}${"*".repeat(Math.min(6, value.length - 2))}`;

function findHits(text) {
  const hits = [];
  for (const value of values) {
    if (!text.includes(value)) continue;
    const pattern = numeric.get(value);
    if (pattern && !pattern.test(text)) continue;
    hits.push(value);
  }
  return hits;
}

function git(...args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

const findings = []; // { location, kind, masked }
function scanLines(location, lines) {
  for (const { lineNumber, text } of lines) {
    for (const value of findHits(text)) {
      findings.push({ location: `${location}:${lineNumber}`, kind: fingerprints.get(value), masked: mask(value) });
    }
  }
}

const args = process.argv.slice(2);
if (args[0] === "--message") {
  const text = fs.readFileSync(args[1], "utf8");
  scanLines("commit message", text.split(/\r?\n/).map((line, index) => ({ lineNumber: index + 1, text: line })));
} else if (args[0] === "--all") {
  for (const file of git("ls-files").split("\n").filter(Boolean)) {
    if (SKIPPED_FILES.test(file)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(repo, file), "utf8");
    } catch {
      continue;
    }
    if (findHits(text).length === 0) continue;
    scanLines(file, text.split(/\r?\n/).map((line, index) => ({ lineNumber: index + 1, text: line })));
  }
} else {
  let file = null;
  let lineNumber = 0;
  const added = new Map();
  for (const line of git("diff", "--cached", "--no-color", "--no-ext-diff", "-U0").split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.startsWith("+++ b/") ? line.slice(6) : null;
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) {
      lineNumber = Number(hunk[1]);
      continue;
    }
    if (!file || SKIPPED_FILES.test(file) || !line.startsWith("+")) continue;
    if (!added.has(file)) added.set(file, []);
    added.get(file).push({ lineNumber, text: line.slice(1) });
    lineNumber += 1;
  }
  for (const [stagedFile, lines] of added) scanLines(stagedFile, lines);
}

if (findings.length === 0) process.exit(0);

console.error("\nBlocked: these lines contain values from your real financial data");
console.error("(/transactions/ exports or /data/ databases). Values are masked.\n");
for (const finding of findings) {
  console.error(`  ${finding.location}  ${finding.kind}  ${finding.masked}`);
}
console.error("\nReplace them with invented values (see \"Sensitive financial data\" in AGENTS.md).");
console.error("If this is a false positive, commit once with SPENT_ALLOW_SENSITIVE=1.\n");
process.exit(1);
