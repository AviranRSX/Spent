import "server-only";

import path from "node:path";
import {
  deleteGlobalSetting,
  getGlobalSetting,
  setGlobalSetting,
} from "@/server/db/queries/settings";
import { decrypt, encrypt } from "@/server/lib/encryption";

export const PHONE_SYNC_MIN_PASSPHRASE_LENGTH = 12;

const ENABLED_KEY = "phone_sync_enabled";
const FOLDER_KEY = "phone_sync_folder";
const PASSPHRASE_KEYS = {
  encrypted: "phone_sync_passphrase_encrypted",
  iv: "phone_sync_passphrase_iv",
  authTag: "phone_sync_passphrase_auth_tag",
} as const;

export const PHONE_SYNC_STATUS_KEYS = {
  lastSyncedAt: "phone_sync_last_synced_at",
  lastSnapshotAt: "phone_sync_last_snapshot_at",
  lastSnapshotBytes: "phone_sync_last_snapshot_bytes",
  lastError: "phone_sync_last_error",
} as const;

/** Invalid settings input; routes turn it into a 400. */
export class PhoneSyncSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhoneSyncSettingsError";
  }
}

export interface PhoneSyncConfig {
  enabled: boolean;
  folder: string | null;
  hasPassphrase: boolean;
}

export function getPhoneSyncConfig(): PhoneSyncConfig {
  return {
    enabled: getGlobalSetting(ENABLED_KEY) === "true",
    folder: getGlobalSetting(FOLDER_KEY) || null,
    hasPassphrase: getGlobalSetting(PASSPHRASE_KEYS.encrypted) != null,
  };
}

/** `folder`: an absolute path, or empty string / null to clear it. */
export function setPhoneSyncConfig(input: {
  enabled?: boolean;
  folder?: string | null;
}): void {
  if (input.folder !== undefined) {
    const folder = input.folder?.trim() ?? "";
    if (folder === "") {
      deleteGlobalSetting(FOLDER_KEY);
    } else if (!path.isAbsolute(folder)) {
      throw new PhoneSyncSettingsError("folder must be an absolute path");
    } else {
      setGlobalSetting(FOLDER_KEY, folder);
    }
  }
  if (input.enabled !== undefined) {
    setGlobalSetting(ENABLED_KEY, input.enabled ? "true" : "false");
  }
}

export function setPhoneSyncPassphrase(passphrase: string): void {
  if (Array.from(passphrase).length < PHONE_SYNC_MIN_PASSPHRASE_LENGTH) {
    throw new PhoneSyncSettingsError(
      `passphrase must be at least ${PHONE_SYNC_MIN_PASSPHRASE_LENGTH} characters`
    );
  }
  const { encrypted, iv, authTag } = encrypt(passphrase);
  setGlobalSetting(PASSPHRASE_KEYS.encrypted, encrypted.toString("hex"));
  setGlobalSetting(PASSPHRASE_KEYS.iv, iv.toString("hex"));
  setGlobalSetting(PASSPHRASE_KEYS.authTag, authTag.toString("hex"));
}

/**
 * Changes whenever the passphrase is set again (the stored ciphertext uses a
 * fresh IV), so callers can tell that a retry with the new passphrase is due.
 * Not secret: it is the value already stored in settings.
 */
export function getPhoneSyncPassphraseStamp(): string | null {
  return getGlobalSetting(PASSPHRASE_KEYS.encrypted);
}

export function getPhoneSyncPassphrase(): string | null {
  const encrypted = getGlobalSetting(PASSPHRASE_KEYS.encrypted);
  const iv = getGlobalSetting(PASSPHRASE_KEYS.iv);
  const authTag = getGlobalSetting(PASSPHRASE_KEYS.authTag);
  if (!encrypted || !iv || !authTag) return null;
  try {
    return decrypt({
      encrypted: Buffer.from(encrypted, "hex"),
      iv: Buffer.from(iv, "hex"),
      authTag: Buffer.from(authTag, "hex"),
    });
  } catch {
    // Undecryptable (for example the local encryption key was regenerated):
    // treat it as unset so the status asks for the passphrase again.
    return null;
  }
}
