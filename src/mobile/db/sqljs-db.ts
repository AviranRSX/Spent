import { createSqlJsDatabase, type SqlJsDatabase } from "./sqljs-adapter";

// Replaces src/server/db/index.ts in the mobile build. The query helpers call
// getDb() synchronously, so the snapshot must be loaded before any request.
// The handle also lives on globalThis._db, the slot the desktop module reads,
// so node tests can run the desktop query modules against it.
const holder = globalThis as unknown as { _db?: SqlJsDatabase };

let current: SqlJsDatabase | null = null;

export function isDatabaseLoaded(): boolean {
  return current !== null;
}

export function getDb(): SqlJsDatabase {
  if (!current) throw new Error("Database not loaded");
  return current;
}

export async function loadDatabase(bytes: Uint8Array): Promise<void> {
  const next = await createSqlJsDatabase(
    bytes,
    typeof window === "undefined"
      ? {}
      : { locateFile: (file: string) => `/${file}` }
  );
  current?.close();
  current = next;
  holder._db = next;
}

export function exportDatabase(): Uint8Array {
  return getDb().export();
}
