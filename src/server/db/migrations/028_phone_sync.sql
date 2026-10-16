-- When the user last decided a category for this row (ISO 8601 UTC). Set only by
-- user recategorize/approve, never by import or AI. Phone sync compares it as a string.
ALTER TABLE transactions ADD COLUMN category_decided_at TEXT;

-- Global like AI settings, not per workspace: one phone syncs every workspace.
CREATE TABLE phone_sync_devices (
  device_id TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  last_applied_seq INTEGER NOT NULL DEFAULT 0,
  applied_count INTEGER NOT NULL DEFAULT 0,
  skipped_newer_count INTEGER NOT NULL DEFAULT 0,
  skipped_mismatch_count INTEGER NOT NULL DEFAULT 0,
  last_file_mtime_ms INTEGER,
  last_seen_at TEXT,
  last_error TEXT
);
