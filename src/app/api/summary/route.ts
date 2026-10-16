import { NextResponse } from "next/server";
import { getSummaryHandler } from "@/server/api-handlers/summary";
import { buildHandlerContext } from "@/server/lib/handler-context";

export async function GET(request: Request) {
  const result = getSummaryHandler(buildHandlerContext(request));
  return NextResponse.json(result.body, { status: result.status });
}
