import { NextResponse } from "next/server";
import { getPhoneSyncStatus } from "@/server/phone-sync/engine";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getPhoneSyncStatus());
}
