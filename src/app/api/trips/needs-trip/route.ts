import { NextResponse } from "next/server";
import { getNeedsTripQueue } from "@/server/db/queries/trips";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  return NextResponse.json({ items: getNeedsTripQueue(workspaceId) });
}
