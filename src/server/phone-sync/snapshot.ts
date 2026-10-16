import "server-only";

import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  type Dirent,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { getDb } from "@/server/db";

/** LIKE patterns for settings keys that hold secrets or phone sync state. */
export const SNAPSHOT_SECRET_SETTING_PATTERNS = [
  "%_encrypted",
  "%_iv",
  "%_auth_tag",
  "phone_sync_%",
];

const SNAPSHOT_DIR_PREFIX = "spent-snapshot-";
const SNAPSHOT_FORMAT_VERSION = "1";
/** A build takes seconds; a temp dir older than this was left by a crash. */
export const STALE_SNAPSHOT_DIR_MS = 60 * 60 * 1000;

/**
 * Removes snapshot temp dirs in os.tmpdir() older than STALE_SNAPSHOT_DIR_MS.
 * A crash between VACUUM INTO and cleanup leaves a plaintext database copy
 * there. Only directories with our prefix are touched. Best effort, never throws.
 */
export function sweepStaleSnapshotDirs(now = Date.now()): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(os.tmpdir(), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(SNAPSHOT_DIR_PREFIX)) continue;
    const dir = path.join(os.tmpdir(), entry.name);
    try {
      if (now - statSync(dir).mtimeMs > STALE_SNAPSHOT_DIR_MS) {
        rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // Gone already or locked; try again next start.
    }
  }
}

export interface SnapshotOptions {
  acks: Record<string, number>;
  now?: Date;
  /** Test-only hook: runs right after VACUUM INTO, to inject failures. */
  afterCopy?: () => void;
}

/**
 * Builds a plaintext, self-contained SQLite copy of the live database with
 * bank credentials, encrypted secrets and phone sync settings removed.
 * Callers must encrypt the bytes before they leave the machine.
 */
export function buildSnapshotDbBytes(opts: SnapshotOptions): Uint8Array {
  // A private temp dir keeps the file name unguessable and lets cleanup remove
  // every SQLite sibling (-wal, -shm, -journal) in one call.
  const dir = mkdtempSync(path.join(os.tmpdir(), SNAPSHOT_DIR_PREFIX));
  const file = path.join(dir, "snapshot.db");
  try {
    getDb().prepare("VACUUM INTO ?").run(file);
    opts.afterCopy?.();

    const copy = new Database(file);
    try {
      // Blank the secret columns instead of deleting rows: transactions and
      // sync_runs reference bank_credentials(id) with ON DELETE SET NULL, so
      // deleting would null their credential_id and break filters and the
      // integrations list on the phone.
      copy
        .prepare(
          "UPDATE bank_credentials SET credentials_encrypted = X'', iv = X'', auth_tag = X''"
        )
        .run();
      for (const table of ["settings", "workspace_settings"]) {
        const del = copy.prepare(`DELETE FROM ${table} WHERE key LIKE ?`);
        for (const pattern of SNAPSHOT_SECRET_SETTING_PATTERNS) del.run(pattern);
      }
      copy.exec(
        "CREATE TABLE phone_sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
      );
      const putMeta = copy.prepare("INSERT INTO phone_sync_meta (key, value) VALUES (?, ?)");
      putMeta.run("format_version", SNAPSHOT_FORMAT_VERSION);
      putMeta.run("created_at", (opts.now ?? new Date()).toISOString());
      putMeta.run("acks", JSON.stringify(opts.acks));
      // DELETE journal mode plus VACUUM rewrites the file without freed pages,
      // so deleted secrets do not linger in the returned bytes.
      copy.pragma("journal_mode = DELETE");
      copy.exec("VACUUM");
    } finally {
      copy.close();
    }
    return new Uint8Array(readFileSync(file));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
