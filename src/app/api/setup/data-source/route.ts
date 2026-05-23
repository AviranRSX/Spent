import { NextResponse } from "next/server";
import {
  isDataSourceMode,
  setDataSourceMode,
} from "@/server/db/queries/settings";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = (await request.json()) as { mode?: unknown };

  if (!isDataSourceMode(body.mode)) {
    return NextResponse.json(
      { success: false, message: "Unsupported data source mode" },
      { status: 400 }
    );
  }

  setDataSourceMode(workspaceId, body.mode);
  return NextResponse.json({ success: true, dataSourceMode: body.mode });
}
