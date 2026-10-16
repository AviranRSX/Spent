import { PhoneSyncCryptoError } from "@/lib/phone-sync/crypto";
import { createSqlJsDatabase, type SqlJsDatabase } from "@/mobile/db/sqljs-adapter";

/** What the sync engine needs to know about a snapshot before it swaps it in. */
export interface SnapshotInfo {
  /** Newest `_migrations` name, or null when the table is missing or empty. */
  schemaVersion: string | null;
  /** Highest applied seq per device id, from `phone_sync_meta`. */
  acks: Record<string, number>;
  /** The PC's UI language (`settings.language`), or null. */
  language: string | null;
  workspaceIds: number[];
}

function optional<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    // Missing table: the snapshot predates it or never had it.
    return fallback;
  }
}

function parseAcks(raw: unknown): Record<string, number> {
  if (typeof raw !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const acks: Record<string, number> = {};
    for (const [deviceId, seq] of Object.entries(parsed)) {
      if (typeof seq === "number" && Number.isInteger(seq) && seq >= 0) acks[deviceId] = seq;
    }
    return acks;
  } catch {
    return {};
  }
}

function read(db: SqlJsDatabase): SnapshotInfo {
  const schema = optional(
    () => db.prepare("SELECT MAX(name) AS name FROM _migrations").get()?.name,
    null
  );
  const acks = optional(
    () => db.prepare("SELECT value FROM phone_sync_meta WHERE key = 'acks'").get()?.value,
    null
  );
  const language = optional(
    () => db.prepare("SELECT value FROM settings WHERE key = 'language'").get()?.value,
    null
  );
  const workspaceIds = optional(
    () =>
      db
        .prepare("SELECT id FROM workspaces ORDER BY id")
        .all()
        .map((row) => Number(row.id)),
    [] as number[]
  );
  return {
    schemaVersion: typeof schema === "string" ? schema : null,
    acks: parseAcks(acks),
    language: typeof language === "string" ? language : null,
    workspaceIds,
  };
}

/**
 * Opens decrypted snapshot bytes in a throwaway sql.js database and reads the
 * schema version, acks, language and workspace ids. Bytes that are not a
 * SQLite database throw `bad_format`.
 */
export async function inspectSnapshot(bytes: Uint8Array): Promise<SnapshotInfo> {
  const db = await createSqlJsDatabase(
    bytes,
    typeof window === "undefined" ? {} : { locateFile: (file: string) => `/${file}` }
  );
  try {
    // sql.js opens anything lazily; the first read reports a non-database file.
    try {
      db.prepare("SELECT count(*) FROM sqlite_master").get();
    } catch {
      throw new PhoneSyncCryptoError("bad_format", "snapshot is not a database");
    }
    return read(db);
  } finally {
    db.close();
  }
}
