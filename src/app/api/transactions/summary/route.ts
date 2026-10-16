import { NextResponse } from "next/server";
import { getTransactionsSummaryHandler } from "@/server/api-handlers/transactions";
import { buildHandlerContext } from "@/server/lib/handler-context";

export async function GET(request: Request) {
  const result = getTransactionsSummaryHandler(buildHandlerContext(request));
  return NextResponse.json(result.body, { status: result.status });
}
