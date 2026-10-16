import { NextResponse } from "next/server";
import { getTripMembershipsHandler } from "@/server/api-handlers/trips";
import { buildHandlerContext } from "@/server/lib/handler-context";

export async function GET(request: Request) {
  const result = getTripMembershipsHandler(buildHandlerContext(request));
  return NextResponse.json(result.body, { status: result.status });
}
