import { NextResponse } from "next/server";
import {
  buildCategorizePreview,
  CategorizePreviewError,
} from "@/server/ai/categorize-preview";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);

  try {
    const result = await buildCategorizePreview(workspaceId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CategorizePreviewError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
