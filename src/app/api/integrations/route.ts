import { NextResponse } from "next/server";
import { listIntegrationsHandler } from "@/server/api-handlers/integrations";
import { buildHandlerContext } from "@/server/lib/handler-context";

export async function GET(request: Request) {
  const result = listIntegrationsHandler(buildHandlerContext(request));
  return NextResponse.json(result.body, { status: result.status });
}
