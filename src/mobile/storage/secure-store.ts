// Small secrets on the phone, kept by capacitor-secure-storage-plugin: values
// are encrypted with a key held in the Android Keystore. The plugin is
// imported lazily so desktop builds and node tests never load it.
import type { SecureStoragePluginPlugin } from "capacitor-secure-storage-plugin";

// snapshotMd5 and lastSyncedAt are not secret, but they describe the local
// copy, so they live here and Disconnect clears them with the rest.
export type SecretKey =
  | "passphrase"
  | "deviceId"
  | "deviceName"
  | "folderId"
  | "folderName"
  | "snapshotMd5"
  | "lastSyncedAt";

const SECRET_KEYS: SecretKey[] = [
  "passphrase",
  "deviceId",
  "deviceName",
  "folderId",
  "folderName",
  "snapshotMd5",
  "lastSyncedAt",
];
const PREFIX = "spent.";

async function storage(): Promise<SecureStoragePluginPlugin> {
  const { SecureStoragePlugin } = await import("capacitor-secure-storage-plugin");
  return SecureStoragePlugin;
}

async function storedKeys(plugin: SecureStoragePluginPlugin): Promise<Set<string>> {
  const { value } = await plugin.keys();
  return new Set(value);
}

export async function getSecret(key: SecretKey): Promise<string | null> {
  const plugin = await storage();
  // get() rejects for a missing key, so check first.
  if (!(await storedKeys(plugin)).has(PREFIX + key)) return null;
  try {
    const { value } = await plugin.get({ key: PREFIX + key });
    return value;
  } catch {
    // The key is listed but can't be decrypted, for example after the
    // Keystore key was lost. Treat it as unset so setup asks again.
    return null;
  }
}

export async function setSecret(key: SecretKey, value: string): Promise<void> {
  const plugin = await storage();
  await plugin.set({ key: PREFIX + key, value });
}

/** Removes every Spent secret (used by Disconnect). */
export async function clearAll(): Promise<void> {
  const plugin = await storage();
  const present = await storedKeys(plugin);
  for (const key of SECRET_KEYS) {
    if (present.has(PREFIX + key)) await plugin.remove({ key: PREFIX + key });
  }
}
