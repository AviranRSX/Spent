/** Name of the newest migration file. A test keeps this equal to the last file in src/server/db/migrations. */
export const APP_SCHEMA_VERSION = "028_phone_sync.sql";

/** Oldest snapshot schema this build can still open. */
export const MIN_SNAPSHOT_SCHEMA_VERSION = "028_phone_sync.sql";
