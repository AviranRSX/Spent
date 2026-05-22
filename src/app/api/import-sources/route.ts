import { NextResponse } from "next/server";
import {
  createImportSource,
  listImportSources,
} from "@/server/db/queries/import-sources";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import {
  isImportSourceKind,
  isImportTemplateType,
  templateMatchesSourceKind,
} from "@/lib/imports/templates";
import type { ImportSourceKind, ImportTemplateType } from "@/lib/types";

export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  return NextResponse.json(listImportSources(workspaceId));
}

export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = (await request.json()) as {
    label?: string;
    kind?: ImportSourceKind;
    templateType?: ImportTemplateType;
    accountHint?: string | null;
  };

  if (!body.label || !body.kind || !body.templateType) {
    return NextResponse.json(
      { success: false, message: "Missing label, kind, or template type" },
      { status: 400 }
    );
  }
  if (
    !isImportSourceKind(body.kind) ||
    !isImportTemplateType(body.templateType)
  ) {
    return NextResponse.json(
      { success: false, message: "Unsupported import source type" },
      { status: 400 }
    );
  }
  if (!templateMatchesSourceKind(body.templateType, body.kind)) {
    return NextResponse.json(
      { success: false, message: "Template does not match source kind" },
      { status: 400 }
    );
  }

  try {
    const id = createImportSource(workspaceId, {
      label: body.label,
      kind: body.kind,
      templateType: body.templateType,
      accountHint: body.accountHint ?? null,
    });
    return NextResponse.json({ success: true, sourceId: id });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create import source";
    const status = /UNIQUE constraint/i.test(message) ? 409 : 400;
    return NextResponse.json({ success: false, message }, { status });
  }
}
