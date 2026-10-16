import { NextResponse } from "next/server";
import { syncPhoneNow } from "@/server/phone-sync/engine";

export async function POST() {
  return NextResponse.json(await syncPhoneNow());
}
