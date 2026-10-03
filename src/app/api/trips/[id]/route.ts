import { NextResponse } from "next/server";
import {
  deleteTrip,
  getTrip,
  getTripDetail,
  updateTrip,
} from "@/server/db/queries/trips";
import { parseTripId, parseTripPatch } from "@/lib/trips/validation";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const id = parseTripId((await params).id);
  if (id == null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const detail = getTripDetail(workspaceId, id);
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(request: Request, { params }: Context) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const id = parseTripId((await params).id);
  if (id == null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const current = getTrip(workspaceId, id);
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body: unknown = await request.json().catch(() => null);
  const parsed = parseTripPatch(body, current);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  return NextResponse.json(updateTrip(workspaceId, id, parsed.value));
}

export async function DELETE(request: Request, { params }: Context) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const id = parseTripId((await params).id);
  if (id == null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  if (!deleteTrip(workspaceId, id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
