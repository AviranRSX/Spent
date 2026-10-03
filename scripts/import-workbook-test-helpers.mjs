import JSZip from "jszip";

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(index) {
  let result = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  }
  return result;
}

export async function buildOpenXmlWorkbook(
  rows,
  { sheetName = "Sheet1", extraEntryCount = 0 } = {}
) {
  const rowXml = rows
    .map((values, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = values
        .map((value, columnIndex) => {
          if (value == null) return "";
          const ref = `${columnName(columnIndex)}${rowNumber}`;
          if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");

  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1" /></sheets></workbook>`
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml" /></Relationships>`
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet><sheetData>${rowXml}</sheetData></worksheet>`
  );
  for (let index = 0; index < extraEntryCount; index += 1) {
    zip.file(`extras/entry-${index}.txt`, "");
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

// Synthetic exports that mirror each institution's real layout (preamble rows,
// header position, totals, section headers). Every value is invented. Never
// replace these with rows copied from a real export.

export function excelSerial(isoDate) {
  return (Date.parse(`${isoDate}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

export const ISRACARD_HEADERS = ["תאריך רכישה", "שם בית עסק", "סכום עסקה", "מטבע עסקה", "סכום חיוב", "מטבע חיוב", "מס' שובר", "פירוט נוסף"];

export const FIXTURE_ACCOUNTS = {
  isracard_bill: "1234",
  max_bill: "5678",
  cal_bill: "4321",
  hapoalim_bank_account: "12-345-67890",
  leumi_bank_account: "123-456789/01",
};

export function buildIsracardWorkbook() {
  return buildOpenXmlWorkbook([
    ["פירוט עסקאות"],
    [],
    ["ישראכרט"],
    [],
    [`כרטיס מסטרקארד המסתיים ב ${FIXTURE_ACCOUNTS.isracard_bill}`],
    ISRACARD_HEADERS,
    ["03.07.2026", "קפה לדוגמה", "18", "₪", "18", "₪", "9001", ""],
    ["05.07.2026", "סופר לדוגמה", "245.9", "₪", "245.9", "₪", "9002", ""],
    ["", "סה\"כ לחיוב", "", "", "263.9", "₪", "", ""],
    [],
    ["עסקאות בחו\"ל"],
    ISRACARD_HEADERS,
    ["07.07.2026", "EXAMPLE HOTEL", "120", "$", "441.6", "₪", "9003", ""],
  ]);
}

export const ISRACARD_REPEATED_HEADER_ROW = 12;

export function buildMaxWorkbook() {
  const account = FIXTURE_ACCOUNTS.max_bill;
  return buildOpenXmlWorkbook([
    ["כל המשתמשים (1)"],
    [`${account}-max`],
    ["07/2026"],
    ["תאריך עסקה", "שם בית העסק", "קטגוריה", "4 ספרות אחרונות של כרטיס האשראי", "סוג עסקה", "סכום חיוב", "מטבע חיוב", "סכום עסקה מקורי", "מטבע עסקה מקורי", "תאריך חיוב", "הערות", "תיוגים", "מועדון הנחות", "מפתח דיסקונט", "אופן ביצוע ההעסקה", "שער המרה ממטבע מקור/התחשבנות לש\"ח"],
    ["02-07-2026", "מסעדה לדוגמה", "מסעדות", account, "רגילה", 86.5, "₪", 86.5, "₪", "10-08-2026"],
    ["04-07-2026", "חנות לדוגמה", "קניות", account, "רגילה", "", "", 120, "₪", ""],
    ["06-07-2026", "חנות לדוגמה", "קניות", account, "רגילה", "", "", 75, "₪", ""],
    [],
    ["סך הכל"],
    [281.5],
  ]);
}

export function buildCalWorkbook() {
  return buildOpenXmlWorkbook([
    [`פירוט עסקאות לכרטיס ויזה המסתיים ב-${FIXTURE_ACCOUNTS.cal_bill}`],
    [],
    ["תאריך עסקה", "שם בית עסק", "סכום בש\"ח", "מועד חיוב", "סוג עסקה", "הערות"],
    [excelSerial("2026-07-31"), "מתנה לדוגמה", 150.25, "", "רגילה", ""],
    [excelSerial("2026-07-30"), "מאפייה לדוגמה", 42.9, "", "רגילה", ""],
    [excelSerial("2026-07-29"), "רהיטים לדוגמה", 900, excelSerial("2026-08-10"), "תשלומים", "תשלום 1 מתוך 3"],
    ["", "סה\"כ", 1093.15, ""],
  ]);
}

// CAL "current statement" export: no per-row billing date, the billing date
// and total live in row 3, and headers contain embedded line breaks.
export const CAL_STATEMENT_ROWS = [
  { date: "2026-07-12", merchant: "סופר לדוגמה", amount: 210.4, type: "רגילה", branch: "מזון ומשקאות" },
  { date: "2026-07-20", merchant: "ספק אינטרנט לדוגמה", amount: 99.9, type: "הוראת קבע", branch: "" },
  { date: "2026-07-31", merchant: "מתנה לדוגמה", amount: 150.25, type: "רגילה", branch: "מתנות" },
];

function formatIsraeliDate(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

export function buildCalStatementWorkbook({ billingDate = "2026-08-10" } = {}) {
  const total = CAL_STATEMENT_ROWS.reduce((sum, row) => sum + row.amount, 0);
  return buildOpenXmlWorkbook(
    [
      [`פירוט עסקאות לחשבון בנק לדוגמה 999-11111 לכרטיס מאסטרקארד זהב המסתיים ב-${FIXTURE_ACCOUNTS.cal_bill}`],
      [],
      [`עסקאות לחיוב ב-${formatIsraeliDate(billingDate)}: ${total.toFixed(2)} ₪`],
      ["תאריך\r\nעסקה", "שם בית עסק", "סכום\r\nעסקה", "סכום\r\nחיוב", "סוג\r\nעסקה", "ענף", "הערות"],
      ...CAL_STATEMENT_ROWS.map((row) => [
        excelSerial(row.date),
        row.merchant,
        row.amount,
        row.amount,
        row.type,
        row.branch,
        "",
      ]),
      [],
      ["את המידע המלא על כל עסקה אפשר למצוא באתר ובאפליקציה של חברת הכרטיס."],
    ],
    { sheetName: "בנק לדוגמה 999-11111" }
  );
}

export function buildHapoalimWorkbook() {
  return buildOpenXmlWorkbook([
    [],
    [],
    ["תנועות בחשבון"],
    [`מספר חשבון  ${FIXTURE_ACCOUNTS.hapoalim_bank_account}  תאריך הפקה  01.08.2026`],
    ["תאריך", "הפעולה", "פרטים", "אסמכתא", "חובה", "זכות", "יתרה בש''ח", "תאריך ערך", "לטובת", "עבור"],
    [excelSerial("2026-07-01"), "משכורת", "המבצע: חברה לדוגמה בע\"מ", 1001, "", 9500, 15000, excelSerial("2026-07-01")],
    [excelSerial("2026-07-02"), "הוראת-קבע", "לטובת: ועד בית לדוגמה", 1002, 350, "", 14650, excelSerial("2026-07-02"), "ועד בית לדוגמה", "דמי ועד"],
  ]);
}

export function buildLeumiHtml() {
  const row = (cells, tag = "td") =>
    `<tr>${cells.map((cell) => `<${tag}>${cell}</${tag}>`).join("")}</tr>`;
  return Buffer.from(`<HTML dir="RTL"><head><META http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body><table>
${row(["בנק לאומי"])}
${row([`מס' חשבון : ‏‏ ‎${FIXTURE_ACCOUNTS.leumi_bank_account}‎ תאריך שמירה/הדפסה: 1/8/2026`])}
${row(["תנועות בחשבון"])}
${row(["תאריך", "תאריך ערך", "תיאור", "אסמכתא", "בחובה", "בזכות", "היתרה בש\"ח", "תאור מורחב", "הערה"], "th")}
${row(["01/07/2026", "01/07/2026", "העברת משכורת", "5550001", "0.00", "9,000.00", "12,000.00", "", ""])}
${row(["03/07/2026", "03/07/2026", "הוראת קבע", "5550002", "1,250.00", "0.00", "10,750.00", "העברה ל: משכיר לדוגמה", ""])}
</table></body></HTML>`);
}

export const PROVIDER_FIXTURES = [
  ["isracard_bill", "card", buildIsracardWorkbook],
  ["max_bill", "card", buildMaxWorkbook],
  ["cal_bill", "card", buildCalWorkbook],
  ["cal_bill", "card", buildCalStatementWorkbook],
  ["hapoalim_bank_account", "bank", buildHapoalimWorkbook],
  ["leumi_bank_account", "bank", buildLeumiHtml],
];
