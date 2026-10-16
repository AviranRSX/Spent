import { NextResponse } from "next/server";
import { getHomeHandler } from "@/server/api-handlers/home";
import { buildHandlerContext } from "@/server/lib/handler-context";
import { getNextRunAt } from "@/server/sync/scheduler";

export async function GET(request: Request) {
  const result = getHomeHandler(
    buildHandlerContext(request, {}, getNextRunAt())
  );
  return NextResponse.json(result.body, { status: result.status });
}
