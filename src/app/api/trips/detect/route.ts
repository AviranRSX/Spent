import { NextResponse } from "next/server";
import { detectTripSuggestions } from "@/server/trips/detection";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const created = detectTripSuggestions(workspaceId);
  return NextResponse.json({ created: created.length });
}
