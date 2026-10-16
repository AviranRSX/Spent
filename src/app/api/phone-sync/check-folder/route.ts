import { NextResponse } from "next/server";
import path from "node:path";
import { checkFolder } from "@/server/phone-sync/folder";

export const dynamic = "force-dynamic";

/** Dry-run check of a folder path for the settings page. Changes no setting. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const folder =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).folder
      : undefined;
  if (typeof folder !== "string" || !path.isAbsolute(folder.trim())) {
    return NextResponse.json(
      { error: "folder must be an absolute path" },
      { status: 400 }
    );
  }
  return NextResponse.json(checkFolder(folder.trim()));
}
