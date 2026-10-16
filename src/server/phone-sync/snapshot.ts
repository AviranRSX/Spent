import "server-only";

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
      copy.prepare("DELETE FROM bank_credentials").run();
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
