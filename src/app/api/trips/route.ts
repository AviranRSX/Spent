import { NextResponse } from "next/server";
import { createTrip } from "@/server/db/queries/trips";
import { getTripsHandler } from "@/server/api-handlers/trips";
import { buildHandlerContext } from "@/server/lib/handler-context";
import { parseTripInput } from "@/lib/trips/validation";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function GET(request: Request) {
  const result = getTripsHandler(buildHandlerContext(request));
  return NextResponse.json(result.body, { status: result.status });
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
