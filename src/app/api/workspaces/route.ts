import { NextResponse } from "next/server";
import { createWorkspace } from "@/server/db/queries/workspaces";
import { listWorkspacesHandler } from "@/server/api-handlers/workspaces";
import { buildHandlerContext } from "@/server/lib/handler-context";

export async function GET(request: Request) {
  const result = listWorkspacesHandler(buildHandlerContext(request));
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const name =
    typeof (body as { name?: unknown })?.name === "string"
      ? ((body as { name: string }).name)
      : "";

  if (!name.trim()) {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 }
    );
  }

  try {
    const ws = createWorkspace(name);
    return NextResponse.json(ws, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create workspace" },
      { status: 400 }
    );
  }
}
