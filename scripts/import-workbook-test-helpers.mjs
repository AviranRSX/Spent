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
          const ref = `${columnName(columnIndex)}${rowNumber}`;
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
