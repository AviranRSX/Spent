import { NextResponse } from "next/server";
import { commitImportFiles } from "@/server/imports/import-transactions";
import { getWorkspace } from "@/server/db/queries/workspaces";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import {
  isImportSourceKind,
  isImportTemplateType,
  templateMatchesSourceKind,
} from "@/lib/imports/templates";
import type { ImportCommitFile } from "@/server/imports/import-transactions";

export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = (await request.json()) as { files?: ImportCommitFile[] };
  const files = body.files ?? [];
  if (files.length === 0) {
    return NextResponse.json(
      { success: false, message: "No preview rows to import" },
      { status: 400 }
    );
  }

  for (const file of files) {
    if (!isImportSourceKind(file.kind) || !isImportTemplateType(file.templateType)) {
      return NextResponse.json(
        { success: false, message: "Unsupported import source type" },
        { status: 400 }
      );
    }
    if (!templateMatchesSourceKind(file.templateType, file.kind)) {
      return NextResponse.json(
        { success: false, message: "Template does not match source kind" },
        { status: 400 }
      );
    }
  }

  const workspace = getWorkspace(workspaceId);
  const result = await commitImportFiles(
    workspaceId,
    workspace?.name ?? `Workspace ${workspaceId}`,
    files
  );

  return NextResponse.json({ success: true, ...result });
}
