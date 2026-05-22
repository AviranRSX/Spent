CREATE TABLE import_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK(length(label) <= 128),
  kind TEXT NOT NULL CHECK(kind IN ('bank','card')),
  template_type TEXT NOT NULL CHECK(template_type IN ('isracard_bill','bank_account','credit_card_export')),
  account_hint TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, label)
);

ALTER TABLE sync_runs ADD COLUMN import_source_id INTEGER REFERENCES import_sources(id) ON DELETE SET NULL;
ALTER TABLE transactions ADD COLUMN import_source_id INTEGER REFERENCES import_sources(id) ON DELETE SET NULL;

CREATE INDEX idx_import_sources_workspace ON import_sources(workspace_id);
CREATE INDEX idx_sync_runs_import_source ON sync_runs(import_source_id);
CREATE INDEX idx_transactions_import_source ON transactions(import_source_id);
