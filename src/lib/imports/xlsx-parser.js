// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = require("jszip");

const IMPORT_TEMPLATE_TYPES = [
  "isracard_bill",
  "bank_account",
  "credit_card_export",
];

const ILS_SYMBOLS = new Set(["₪", "שח", "ש\"ח", "ILS", "NIS"]);

function asText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("result" in value) return asText(value.result);
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? "").join("").trim();
    }
  }
  return String(value).trim();
}

function asNumber(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = asText(value).replace(/,/g, "").replace(/[₪$€]/g, "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function currencyCode(value) {
  const text = asText(value);
  if (!text) return "ILS";
  if (ILS_SYMBOLS.has(text)) return "ILS";
  if (text === "$") return "USD";
  if (text === "€") return "EUR";
  return text;
}

function excelSerialToISO(serial) {
  const epoch = Date.UTC(1899, 11, 30);
  const date = new Date(epoch + serial * 86400000);
  return date.toISOString().slice(0, 10);
}

function dateToISO(value, formats) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return excelSerialToISO(value);
  const text = asText(value);
  for (const format of formats) {
    const match = text.match(format.re);
    if (!match) continue;
    const day = Number(match.groups.day);
    const month = Number(match.groups.month);
    let year = Number(match.groups.year);
    if (year < 100) year += 2000;
    if (!day || !month || !year) return null;
    return `${year.toString().padStart(4, "0")}-${month
      .toString()
      .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  }
  return null;
}

function rowValues(row) {
  return row.values ?? [];
}

function rowTexts(row) {
  return rowValues(row).map(asText);
}

function textIncludesAll(values, needles) {
  const joined = values.join("|");
  return needles.every((needle) => joined.includes(needle));
}

function findHeaderRow(sheet, needles) {
  for (let rowNo = 1; rowNo <= sheet.rowCount; rowNo += 1) {
    const texts = rowTexts(sheet.getRow(rowNo));
    if (textIncludesAll(texts, needles)) return rowNo;
  }
  return null;
}

function signedCardAmount(value) {
  const amount = asNumber(value);
  if (amount == null) return null;
  return amount === 0 ? 0 : -Math.abs(amount);
}

function normalizeDescription(parts) {
  return parts.map(asText).filter(Boolean).join(" · ").replace(/\s+/g, " ").trim();
}

function error(sheetName, rowNumber, message) {
  return { sheetName, rowNumber, message };
}

function parseIsracard(workbook, sourceLabel) {
  const transactions = [];
  const errors = [];
  for (const sheet of workbook.worksheets) {
    const headerRow = findHeaderRow(sheet, ["תאריך רכישה", "שם בית עסק", "סכום חיוב"]);
    if (!headerRow) continue;
    const accountLine = rowTexts(sheet.getRow(5)).find((text) => /\d{4}/.test(text));
    const accountNumber = accountLine?.match(/\d{4,}/)?.[0] ?? sourceLabel;
    for (let rowNo = headerRow + 1; rowNo <= sheet.rowCount; rowNo += 1) {
      const vals = rowValues(sheet.getRow(rowNo));
      const date = dateToISO(vals[0], [
        { re: /^(?<day>\d{1,2})\.(?<month>\d{1,2})\.(?<year>\d{2,4})$/ },
      ]);
      const description = asText(vals[1]);
      if (vals.some((value) => {
        const text = asText(value);
        return text.includes("סך") || text.includes('סה"כ');
      })) {
        continue;
      }
      if (!date && !description) continue;
      if (!date || !description) {
        errors.push(error(sheet.name, rowNo, "Missing date or merchant"));
        continue;
      }
      const chargedAmount = signedCardAmount(vals[4]);
      const originalAmount = signedCardAmount(vals[2]);
      if (chargedAmount == null || originalAmount == null) {
        errors.push(error(sheet.name, rowNo, "Missing amount"));
        continue;
      }
      transactions.push({
        accountNumber,
        date,
        processedDate: date,
        originalAmount,
        originalCurrency: currencyCode(vals[3]),
        chargedAmount,
        chargedCurrency: currencyCode(vals[5]),
        description,
        memo: asText(vals[7]) || undefined,
        type: "normal",
        status: "completed",
        identifier: asText(vals[6]) || undefined,
      });
    }
  }
  return { transactions, errors };
}

function parseBankAccount(workbook, sourceLabel) {
  const transactions = [];
  const errors = [];
  for (const sheet of workbook.worksheets) {
    const headerRow = findHeaderRow(sheet, ["תאריך", "הפעולה", "חובה", "זכות"]);
    if (!headerRow) continue;
    const accountLine = rowTexts(sheet.getRow(4)).join(" ");
    const accountNumber = accountLine.match(/\d{2}-\d{3}-\d{5}/)?.[0] ?? sourceLabel;
    for (let rowNo = headerRow + 1; rowNo <= sheet.rowCount; rowNo += 1) {
      const vals = rowValues(sheet.getRow(rowNo));
      const date = dateToISO(vals[0], []);
      const action = asText(vals[1]);
      if (!date && !action) continue;
      const debit = asNumber(vals[4]);
      const credit = asNumber(vals[5]);
      const rawAmount = credit != null && credit !== 0 ? credit : debit != null ? -Math.abs(debit) : null;
      if (!date || !action || rawAmount == null) {
        errors.push(error(sheet.name, rowNo, "Missing date, action, or amount"));
        continue;
      }
      const description = normalizeDescription([action, vals[2], vals[8], vals[9]]);
      transactions.push({
        accountNumber,
        date,
        processedDate: dateToISO(vals[7], []) ?? date,
        originalAmount: rawAmount,
        originalCurrency: "ILS",
        chargedAmount: rawAmount,
        chargedCurrency: "ILS",
        description,
        memo: asText(vals[2]) || undefined,
        type: "normal",
        status: "completed",
        identifier: asText(vals[3]) || undefined,
      });
    }
  }
  return { transactions, errors };
}

function parseCreditCardExport(workbook, sourceLabel) {
  const transactions = [];
  const errors = [];
  for (const sheet of workbook.worksheets) {
    const headerRow = findHeaderRow(sheet, ["תאריך עסקה", "שם בית העסק", "סכום חיוב"]);
    if (!headerRow) continue;
    for (let rowNo = headerRow + 1; rowNo <= sheet.rowCount; rowNo += 1) {
      const vals = rowValues(sheet.getRow(rowNo));
      const date = dateToISO(vals[0], [
        { re: /^(?<day>\d{1,2})-(?<month>\d{1,2})-(?<year>\d{2,4})$/ },
        { re: /^(?<day>\d{1,2})\/(?<month>\d{1,2})\/(?<year>\d{2,4})$/ },
      ]);
      const description = asText(vals[1]);
      if (!date && !description) continue;
      if (description === "סך הכל") continue;
      const chargedAmount = signedCardAmount(vals[5]);
      const originalAmount = signedCardAmount(vals[7]);
      if (!date || !description || chargedAmount == null || originalAmount == null) {
        errors.push(error(sheet.name, rowNo, "Missing date, merchant, or amount"));
        continue;
      }
      transactions.push({
        accountNumber: asText(vals[3]) || sourceLabel,
        date,
        processedDate:
          dateToISO(vals[9], [
            { re: /^(?<day>\d{1,2})-(?<month>\d{1,2})-(?<year>\d{2,4})$/ },
            { re: /^(?<day>\d{1,2})\/(?<month>\d{1,2})\/(?<year>\d{2,4})$/ },
          ]) ?? date,
        originalAmount,
        originalCurrency: currencyCode(vals[8]),
        chargedAmount,
        chargedCurrency: currencyCode(vals[6]),
        description,
        memo: asText(vals[10]) || undefined,
        type: asText(vals[4]).includes("חודשי") ? "installments" : "normal",
        status: "completed",
        identifier: normalizeDescription([vals[3], vals[13]]) || undefined,
      });
    }
  }
  return { transactions, errors };
}

async function parseWorkbookBuffer(buffer, options) {
  const workbook = await readOpenXmlWorkbook(buffer);
  const sourceLabel = options.sourceLabel || "Imported source";
  switch (options.templateType) {
    case "isracard_bill":
      return parseIsracard(workbook, sourceLabel);
    case "bank_account":
      return parseBankAccount(workbook, sourceLabel);
    case "credit_card_export":
      return parseCreditCardExport(workbook, sourceLabel);
    default:
      throw new Error(`Unsupported import template: ${options.templateType}`);
  }
}

function xmlDecode(value) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function columnIndex(cellRef) {
  const letters = cellRef.replace(/\d/g, "").toUpperCase();
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

function attr(text, name) {
  const match = text.match(new RegExp(`${name}="([^"]*)"`));
  return match ? xmlDecode(match[1]) : "";
}

function extractTextNodes(xml) {
  return [...xml.matchAll(/<[^:>]*:?t\b[^>]*>([\s\S]*?)<\/[^:>]*:?t>/g)]
    .map((m) => xmlDecode(m[1]))
    .join("");
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<[^:>]*:?si\b[^>]*>([\s\S]*?)<\/[^:>]*:?si>/g)].map((m) =>
    extractTextNodes(m[1])
  );
}

function parseSheet(xml, name, sharedStrings) {
  const rows = new Map();
  for (const rowMatch of xml.matchAll(/<[^:>]*:?row\b([^>]*)>([\s\S]*?)<\/[^:>]*:?row>/g)) {
    const rowNumber = Number(attr(rowMatch[1], "r"));
    if (!Number.isFinite(rowNumber)) continue;
    const values = [];
    for (const cellMatch of rowMatch[2].matchAll(/<[^:>]*:?c\b([^>]*)>([\s\S]*?)<\/[^:>]*:?c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = attr(attrs, "r");
      if (!ref) continue;
      const col = columnIndex(ref);
      const type = attr(attrs, "t");
      const raw = body.match(/<[^:>]*:?v>([\s\S]*?)<\/[^:>]*:?v>/)?.[1] ?? "";
      let value = "";
      if (type === "s") {
        value = sharedStrings[Number(raw)] ?? "";
      } else if (type === "inlineStr") {
        value = extractTextNodes(body);
      } else if (raw !== "") {
        const parsed = Number(raw);
        value = Number.isFinite(parsed) ? parsed : xmlDecode(raw);
      }
      values[col] = value;
    }
    rows.set(rowNumber, { values });
  }
  const rowCount = Math.max(0, ...rows.keys());
  return {
    name,
    rowCount,
    getRow(rowNumber) {
      return rows.get(rowNumber) ?? { values: [] };
    },
  };
}

async function readOpenXmlWorkbook(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const sharedStrings = parseSharedStrings(
    zip.file("xl/sharedStrings.xml")
      ? await zip.file("xl/sharedStrings.xml").async("text")
      : ""
  );
  const sheetFiles = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const worksheets = [];
  for (let i = 0; i < sheetFiles.length; i += 1) {
    const path = sheetFiles[i];
    const xml = await zip.file(path).async("text");
    worksheets.push(parseSheet(xml, `Sheet${i + 1}`, sharedStrings));
  }
  return { worksheets };
}

module.exports = {
  IMPORT_TEMPLATE_TYPES,
  parseWorkbookBuffer,
};
