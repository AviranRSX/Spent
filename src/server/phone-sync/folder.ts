import "server-only";

import fs from "node:fs";
import path from "node:path";
import {
  SNAPSHOT_FILE,
  SNAPSHOT_TMP_FILE,
  parseChangeFileName,
} from "@/lib/phone-sync/format";

const WRITE_PROBE_FILE = ".spent-write-test";

export type FolderCheck =
  | { ok: true }
  | { ok: false; reason: "folder_unavailable" | "not_writable" };

/** Checks that the folder exists and is writable. Never creates anything but a probe file inside it. */
export function checkFolder(folder: string | null): FolderCheck {
  if (!folder) return { ok: false, reason: "folder_unavailable" };
  try {
    if (!fs.statSync(folder).isDirectory()) {
      return { ok: false, reason: "folder_unavailable" };
    }
  } catch {
    return { ok: false, reason: "folder_unavailable" };
  }
  const probe = path.join(folder, WRITE_PROBE_FILE);
  try {
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
    return { ok: true };
  } catch {
    fs.rmSync(probe, { force: true });
    return { ok: false, reason: "not_writable" };
  }
}

/**
 * Writes the snapshot to a tmp file and renames it over the real one, so a
 * syncing Drive client never uploads a half-written snapshot.
 */
export function writeSnapshotAtomic(folder: string, bytes: Uint8Array): void {
  const tmp = path.join(folder, SNAPSHOT_TMP_FILE);
  try {
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, path.join(folder, SNAPSHOT_FILE));
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

export interface ChangeFileEntry {
  deviceId: string;
  path: string;
  mtimeMs: number;
}

export function listChangeFiles(folder: string): ChangeFileEntry[] {
  const files: ChangeFileEntry[] = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const deviceId = parseChangeFileName(entry.name);
    if (!deviceId) continue;
    const filePath = path.join(folder, entry.name);
    try {
      // Whole ms: the column is INTEGER and Drive can report fractional mtimes.
      files.push({ deviceId, path: filePath, mtimeMs: Math.trunc(fs.statSync(filePath).mtimeMs) });
    } catch {
      // Removed between readdir and stat; pick it up next time.
    }
  }
  return files;
}
