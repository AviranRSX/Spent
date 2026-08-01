import { NextResponse } from "next/server";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import {
  detectWorkbookBuffer,
  parseWorkbookBuffer,
} from "@/lib/imports/xlsx-parser";
import { getImportTemplateLabel } from "@/lib/imports/templates";
import { previewImportRows } from "@/server/imports/import-transactions";
import { previewImportUploadedWorkbooks } from "@/server/imports/preview-workbooks";
import {
  createImportUploadLimitResponse,
  getImportRequestLimitViolation,
  getImportUploadLimitViolation,
} from "@/server/imports/import-upload-limits";

export async function POST(request: Request) {
  const requestViolation = getImportRequestLimitViolation(
    request.headers.get("content-length")
  );
  if (requestViolation) return createImportUploadLimitResponse(requestViolation);

  const form = await request.formData();
  const files = form
    .getAll("files")
    .filter((file): file is File => file instanceof File);
  if (files.length === 0) {
    return NextResponse.json(
      { success: false, message: "Choose at least one workbook" },
      { status: 400 }
    );
  }

  const uploadViolation = getImportUploadLimitViolation(files);
  if (uploadViolation) return createImportUploadLimitResponse(uploadViolation);

  const workspaceId = getWorkspaceIdFromRequest(request);

  const previews = await previewImportUploadedWorkbooks(workspaceId, files, {
    detectWorkbookBuffer,
    parseWorkbookBuffer,
    getImportTemplateLabel,
    previewImportRows,
  });

  return NextResponse.json({ success: true, files: previews });
}
