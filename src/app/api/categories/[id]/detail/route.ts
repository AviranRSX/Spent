import { NextResponse } from "next/server";
import { getCategoryDetailHandler } from "@/server/api-handlers/categories";
import { buildHandlerContext } from "@/server/lib/handler-context";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = getCategoryDetailHandler(buildHandlerContext(request, { id }));
  return NextResponse.json(result.body, { status: result.status });
}
