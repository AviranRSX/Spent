import { NextResponse } from "next/server";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { parseWorkbookBuffer } from "@/lib/imports/xlsx-parser";
import {
  getImportTemplateLabel,
  isImportSourceKind,
  isImportTemplateType,
  templateMatchesSourceKind,
} from "@/lib/imports/templates";
import { previewImportRows } from "@/server/imports/import-transactions";
import type { ImportSourceKind, ImportTemplateType } from "@/lib/types";

interface MetadataItem {
  fileName: string;
  kind: ImportSourceKind;
  templateType: ImportTemplateType;
}

export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const form = await request.formData();
  const metadataText = form.get("metadata");
  if (typeof metadataText !== "string") {
    return NextResponse.json(
      { success: false, message: "Missing import metadata" },
      { status: 400 }
    );
  }

  const metadata = JSON.parse(metadataText) as MetadataItem[];
  const files = form.getAll("files").filter((file): file is File => file instanceof File);
  if (files.length === 0 || metadata.length !== files.length) {
    return NextResponse.json(
      { success: false, message: "Every file needs import metadata" },
      { status: 400 }
    );
  }

  const previews = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const item = metadata[i];
    if (!isImportSourceKind(item.kind) || !isImportTemplateType(item.templateType)) {
      return NextResponse.json(
        { success: false, message: "Unsupported import source type" },
        { status: 400 }
      );
    }
    if (!templateMatchesSourceKind(item.templateType, item.kind)) {
      return NextResponse.json(
        { success: false, message: "Template does not match source kind" },
        { status: 400 }
      );
    }

    const parsed = await parseWorkbookBuffer(Buffer.from(await file.arrayBuffer()), {
      templateType: item.templateType,
      sourceLabel: getImportTemplateLabel(item.templateType),
    });
    const preview = previewImportRows(workspaceId, parsed.transactions);
    previews.push({
      fileName: file.name,
      kind: item.kind,
      templateType: item.templateType,
      rows: preview.rows,
      duplicateCount: preview.duplicateCount,
      errors: parsed.errors,
    });
  }

  return NextResponse.json({ success: true, files: previews });
}
