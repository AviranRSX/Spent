// App-private files on the phone (Directory.Data), through
// @capacitor/filesystem. The plugin is imported lazily so desktop builds and
// node tests never load it; tests pass a fake through createLocalFiles.
import type { Directory, FilesystemPlugin } from "@capacitor/filesystem";

const SNAPSHOT_FILE = "snapshot.spent.enc";
const OUTBOX_FILE = "outbox.bin";
const CORRUPT_OUTBOX_FILE = "outbox.corrupt.bin";
const TMP_SUFFIX = ".tmp";

/** The part of the Filesystem plugin these helpers use. */
export type LocalFs = Pick<FilesystemPlugin, "stat" | "readFile" | "writeFile" | "deleteFile" | "rename">;

export interface LocalFiles {
  readSnapshotBlob(): Promise<Uint8Array | null>;
  writeSnapshotBlob(bytes: Uint8Array): Promise<void>;
  readOutboxBlob(): Promise<Uint8Array | null>;
  writeOutboxBlob(bytes: Uint8Array): Promise<void>;
  /** Moves an outbox that can't be decoded out of the way, keeping its bytes. */
  setAsideOutboxBlob(): Promise<void>;
  wipeLocalData(): Promise<void>;
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

export function createLocalFiles(
  open: () => Promise<{ fs: LocalFs; directory: Directory }>
): LocalFiles {
  async function exists(path: string): Promise<boolean> {
    const { fs, directory } = await open();
    try {
      await fs.stat({ path, directory });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reads `path`. If it is missing but `<path>.tmp` exists, a write was cut
   * off between deleting the old file and the rename, after the temp file was
   * fully written, so the temp file is promoted and read. Otherwise an outbox
   * write interrupted there would silently lose unacked edits.
   */
  async function readBlob(path: string): Promise<Uint8Array | null> {
    const { fs, directory } = await open();
    if (!(await exists(path))) {
      const tmp = path + TMP_SUFFIX;
      if (!(await exists(tmp))) return null;
      await fs.rename({ from: tmp, to: path, directory, toDirectory: directory });
    }
    const result = await fs.readFile({ path, directory });
    if (typeof result.data !== "string") {
      return new Uint8Array(await result.data.arrayBuffer());
    }
    return fromBase64(result.data);
  }

  /**
   * Writes to `<path>.tmp`, then renames it over `path`, so a crash mid-write
   * never leaves a truncated file under the real name. The old file is deleted
   * first because the plugin does not promise that rename overwrites; readBlob
   * recovers if the app dies between the delete and the rename.
   */
  async function writeBlobAtomically(path: string, bytes: Uint8Array): Promise<void> {
    const { fs, directory } = await open();
    const tmp = path + TMP_SUFFIX;
    await fs.writeFile({ path: tmp, directory, data: toBase64(bytes) });
    if (await exists(path)) await fs.deleteFile({ path, directory });
    await fs.rename({ from: tmp, to: path, directory, toDirectory: directory });
  }

  return {
    readSnapshotBlob: () => readBlob(SNAPSHOT_FILE),
    writeSnapshotBlob: (bytes) => writeBlobAtomically(SNAPSHOT_FILE, bytes),
    readOutboxBlob: () => readBlob(OUTBOX_FILE),
    writeOutboxBlob: (bytes) => writeBlobAtomically(OUTBOX_FILE, bytes),
    async setAsideOutboxBlob() {
      const { fs, directory } = await open();
      if (!(await exists(OUTBOX_FILE))) return;
      if (await exists(CORRUPT_OUTBOX_FILE)) {
        await fs.deleteFile({ path: CORRUPT_OUTBOX_FILE, directory });
      }
      await fs.rename({
        from: OUTBOX_FILE,
        to: CORRUPT_OUTBOX_FILE,
        directory,
        toDirectory: directory,
      });
    },
    /** Deletes the local snapshot and outbox, including leftover temp and set-aside files. */
    async wipeLocalData() {
      const { fs, directory } = await open();
      for (const name of [SNAPSHOT_FILE, OUTBOX_FILE, CORRUPT_OUTBOX_FILE]) {
        for (const path of [name, name + TMP_SUFFIX]) {
          if (await exists(path)) await fs.deleteFile({ path, directory });
        }
      }
    },
  };
}

const device = createLocalFiles(async () => {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  return { fs: Filesystem, directory: Directory.Data };
});

export const {
  readSnapshotBlob,
  writeSnapshotBlob,
  readOutboxBlob,
  writeOutboxBlob,
  setAsideOutboxBlob,
  wipeLocalData,
} = device;
