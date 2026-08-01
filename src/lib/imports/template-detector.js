const IMPORT_SIGNATURES = [
  {
    templateType: "isracard_bill",
    kind: "card",
    container: "open_xml",
    headers: ["תאריך רכישה", "שם בית עסק", "סכום עסקה", "מטבע עסקה", "סכום חיוב", "מטבע חיוב", "מס' שובר", "פירוט נוסף"],
  },
  {
    templateType: "max_bill",
    kind: "card",
    container: "open_xml",
    headers: ["תאריך עסקה", "שם בית העסק", "4 ספרות אחרונות של כרטיס האשראי", "סוג עסקה", "סכום חיוב", "מטבע חיוב", "סכום עסקה מקורי", "מטבע עסקה מקורי", "תאריך חיוב"],
  },
  {
    templateType: "cal_bill",
    kind: "card",
    container: "open_xml",
    headers: ["תאריך עסקה", "שם בית עסק", "סכום בש\"ח", "מועד חיוב"],
  },
  {
    templateType: "hapoalim_bank_account",
    kind: "bank",
    container: "open_xml",
    headers: ["תאריך", "הפעולה", "חובה", "זכות", "תאריך ערך"],
  },
  {
    templateType: "leumi_bank_account",
    kind: "bank",
    container: "html",
    headers: ["תאריך", "תאריך ערך", "תיאור", "אסמכתא", "בחובה", "בזכות"],
  },
];

function normalizeImportHeader(value) {
  return String(value ?? "")
    .replace(/[\u200e\u200f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectImportTemplate(container, workbook) {
  const matches = new Map();
  for (const sheet of workbook.worksheets) {
    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const headers = new Set(
        (sheet.getRow(rowNumber).values ?? []).map(normalizeImportHeader)
      );
      for (const signature of IMPORT_SIGNATURES) {
        if (
          signature.container === container &&
          signature.headers.every((header) => headers.has(header))
        ) {
          matches.set(signature.templateType, signature);
        }
      }
    }
  }

  const resolved = [...matches.values()];
  if (resolved.length === 1) {
    return {
      ok: true,
      templateType: resolved[0].templateType,
      kind: resolved[0].kind,
    };
  }
  return {
    ok: false,
    code: resolved.length === 0 ? "unsupported" : "ambiguous",
    message:
      resolved.length === 0
        ? "Unsupported workbook format"
        : "Ambiguous workbook format",
    matches: resolved.map((entry) => entry.templateType),
  };
}

module.exports = {
  detectImportTemplate,
  normalizeImportHeader,
};
