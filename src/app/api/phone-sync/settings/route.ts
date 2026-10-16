import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { syncPhoneNow } from "@/server/phone-sync/engine";
import {
  PHONE_SYNC_MIN_PASSPHRASE_LENGTH,
  PhoneSyncSettingsError,
  setPhoneSyncConfig,
  setPhoneSyncPassphrase,
} from "@/server/phone-sync/settings";

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return badRequest("Body must be an object");
  }
  const { enabled, folder, passphrase } = body as Record<string, unknown>;
  if (enabled !== undefined && typeof enabled !== "boolean") {
    return badRequest("enabled must be a boolean");
  }
  if (folder !== undefined && typeof folder !== "string") {
    return badRequest("folder must be a string");
  }
  if (passphrase !== undefined && typeof passphrase !== "string") {
    return badRequest("passphrase must be a string");
  }
  if (
    typeof passphrase === "string" &&
    Array.from(passphrase).length < PHONE_SYNC_MIN_PASSPHRASE_LENGTH
  ) {
    return badRequest(
      `passphrase must be at least ${PHONE_SYNC_MIN_PASSPHRASE_LENGTH} characters`
    );
  }

  try {
    getDb().transaction(() => {
      setPhoneSyncConfig({ enabled, folder });
      if (typeof passphrase === "string") setPhoneSyncPassphrase(passphrase);
    })();
  } catch (err) {
    if (err instanceof PhoneSyncSettingsError) return badRequest(err.message);
    throw err;
  }

  // Starts the engine when enabled (or syncs with the new settings), stops it when disabled.
  return NextResponse.json(await syncPhoneNow());
}
