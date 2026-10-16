// App-private files on the phone (Directory.Data), through
// @capacitor/filesystem. The plugin is imported lazily so desktop builds and
// node tests never load it.
import type { Directory, FilesystemPlugin } from "@capacitor/filesystem";

const SNAPSHOT_FILE = "snapshot.spent.enc";
const OUTBOX_FILE = "outbox.bin";
const TMP_SUFFIX = ".tmp";

async function filesystem(): Promise<{ fs: FilesystemPlugin; data: Directory }> {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  return { fs: Filesystem, data: Directory.Data };
}

// Without an encoding the plugin reads and writes base64 strings.
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function exists(path: string): Promise<boolean> {
  const { fs, data } = await filesystem();
  try {
    await fs.stat({ path, directory: data });
    return true;
  } catch {
    return false;
  }
}

async function readBlob(path: string): Promise<Uint8Array | null> {
  if (!(await exists(path))) return null;
  const { fs, data } = await filesystem();
  const result = await fs.readFile({ path, directory: data });
  if (typeof result.data !== "string") {
    return new Uint8Array(await result.data.arrayBuffer());
  }
  return fromBase64(result.data);
}

/**
 * Writes to `<path>.tmp`, then renames it over `path`, so a crash mid-write
 * never leaves a truncated file under the real name. The old file is deleted
 * first because the plugin does not promise that rename overwrites.
 */
async function writeBlobAtomically(path: string, bytes: Uint8Array): Promise<void> {
  const { fs, data: directory } = await filesystem();
  const tmp = path + TMP_SUFFIX;
  await fs.writeFile({ path: tmp, directory, data: toBase64(bytes) });
  if (await exists(path)) await fs.deleteFile({ path, directory });
  await fs.rename({ from: tmp, to: path, directory, toDirectory: directory });
}

export function readSnapshotBlob(): Promise<Uint8Array | null> {
  return readBlob(SNAPSHOT_FILE);
}

export function writeSnapshotBlob(bytes: Uint8Array): Promise<void> {
  return writeBlobAtomically(SNAPSHOT_FILE, bytes);
}

export function readOutboxBlob(): Promise<Uint8Array | null> {
  return readBlob(OUTBOX_FILE);
}

export function writeOutboxBlob(bytes: Uint8Array): Promise<void> {
  return writeBlobAtomically(OUTBOX_FILE, bytes);
}

/** Deletes the local snapshot and outbox, including leftover temp files. */
export async function wipeLocalData(): Promise<void> {
  const { fs, data } = await filesystem();
  for (const name of [SNAPSHOT_FILE, OUTBOX_FILE]) {
    for (const path of [name, name + TMP_SUFFIX]) {
      if (await exists(path)) await fs.deleteFile({ path, directory: data });
    }
  }
}
