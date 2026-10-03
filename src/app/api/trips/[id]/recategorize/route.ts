import { NextResponse } from "next/server";
import {
  buildCategorizePreview,
  CategorizePreviewError,
} from "@/server/ai/categorize-preview";
import { getTravelRecategorizeIds } from "@/server/db/queries/trips";
import { parseTripId } from "@/lib/trips/validation";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const id = parseTripId((await params).id);
  if (id == null) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const ids = getTravelRecategorizeIds(workspaceId, id);
  if (ids === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (ids.length === 0) {
    return NextResponse.json({
      uncategorizedCount: 0,
      assignments: [],
      proposedCategories: [],
      existingCategoryUsage: {},
      errors: [],
    });
  }

  try {
    const result = await buildCategorizePreview(workspaceId, undefined, {
      transactionIds: ids,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CategorizePreviewError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
