import { NextResponse } from "next/server";
import { getAccountNumbersHandler } from "@/server/api-handlers/transactions";
import { buildHandlerContext } from "@/server/lib/handler-context";

export async function GET(request: Request) {
  const result = getAccountNumbersHandler(buildHandlerContext(request));
  return NextResponse.json(result.body, { status: result.status });
}
