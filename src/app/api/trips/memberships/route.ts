import { NextResponse } from "next/server";
import { getTransactionTripInfo } from "@/server/db/queries/trips";
import { parseTransactionIds } from "@/lib/trips/validation";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const ids = parseTransactionIds(searchParams.getAll("ids").map(Number));
  if (!ids) return NextResponse.json({});
  return NextResponse.json(getTransactionTripInfo(workspaceId, ids));
}
