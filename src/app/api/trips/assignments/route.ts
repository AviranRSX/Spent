import { NextResponse } from "next/server";
import {
  clearTripAssignments,
  setTripAssignments,
} from "@/server/db/queries/trips";
import {
  parseAssignmentBody,
  parseTransactionIds,
} from "@/lib/trips/validation";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body: unknown = await request.json().catch(() => null);
  const parsed = parseAssignmentBody(body);
  if (!parsed) {
    return NextResponse.json({ error: "invalidBody" }, { status: 400 });
  }
  const result = setTripAssignments(workspaceId, parsed.transactionIds, parsed.tripId);
  if (!result.ok) {
    const status = result.reason === "trip-not-found" ? 404 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }
  return NextResponse.json({ success: true, count: result.count });
}

export async function DELETE(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = (await request.json().catch(() => null)) as {
    transactionIds?: unknown;
  } | null;
  const transactionIds = parseTransactionIds(body?.transactionIds);
  if (!transactionIds) {
    return NextResponse.json({ error: "invalidBody" }, { status: 400 });
  }
  const count = clearTripAssignments(workspaceId, transactionIds);
  return NextResponse.json({ success: true, count });
}
