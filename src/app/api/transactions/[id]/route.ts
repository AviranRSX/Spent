import { NextResponse } from "next/server";
import { setTransactionKind } from "@/server/db/queries/transactions";
import {
  applyUserCategory,
  approveCategory,
} from "@/server/lib/category-decisions";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const { id } = await params;
  const body = (await request.json()) as { categoryId: number };

  if (!body.categoryId) {
    return NextResponse.json(
      { error: "categoryId is required" },
      { status: 400 }
    );
  }

  const result = applyUserCategory(workspaceId, Number(id), body.categoryId);
  if (!result.ok) {
    if (result.reason === "not_found") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "categoryId is not a category in this workspace" },
      { status: 400 }
    );
  }

  return NextResponse.json({ success: true });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    kind?: unknown;
    approve?: unknown;
  };

  const numericId = Number(id);

  if (body.approve === true) {
    const result = approveCategory(workspaceId, numericId);
    if (!result.ok) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  }

  if (
    body.kind !== "expense" &&
    body.kind !== "income" &&
    body.kind !== "transfer"
  ) {
    return NextResponse.json(
      { error: "kind must be 'expense', 'income', or 'transfer', or set approve:true" },
      { status: 400 }
    );
  }

  setTransactionKind(workspaceId, numericId, body.kind);

  return NextResponse.json({ success: true });
}
