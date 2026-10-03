import { NextResponse } from "next/server";
import { createTrip, getTripsOverview } from "@/server/db/queries/trips";
import { parseTripInput } from "@/lib/trips/validation";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  return NextResponse.json(getTripsOverview(workspaceId));
}

export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body: unknown = await request.json().catch(() => null);
  const parsed = parseTripInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const trip = createTrip(workspaceId, parsed.value.input, parsed.value.status);
  return NextResponse.json(trip, { status: 201 });
}
