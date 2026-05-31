-- Allow the same category name to exist separately for expense and income.
-- This lets "Transfers" appear in both lists while still preventing duplicate
-- names inside the same kind.
CREATE TABLE categories_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  icon TEXT,
  kind TEXT NOT NULL DEFAULT 'expense' CHECK(kind IN ('expense','income')),
  budget_mode TEXT NOT NULL DEFAULT 'budgeted'
    CHECK(budget_mode IN ('budgeted','tracking')),
  description TEXT,
  CHECK (parent_id IS NULL OR parent_id <> id),
  UNIQUE(workspace_id, kind, name)
);

INSERT INTO categories_new
  (id, workspace_id, parent_id, name, color, icon, kind, budget_mode, description)
SELECT id, workspace_id, parent_id, name, color, icon, kind, budget_mode, description
FROM categories;

DROP TABLE categories;
ALTER TABLE categories_new RENAME TO categories;

CREATE INDEX idx_categories_workspace ON categories(workspace_id);
CREATE INDEX idx_categories_kind ON categories(kind);
CREATE INDEX idx_categories_parent ON categories(parent_id);

INSERT OR IGNORE INTO categories
  (workspace_id, parent_id, name, color, icon, kind, budget_mode, description)
SELECT
  w.id,
  NULL,
  'Transfers',
  '#A2AAC2',
  'arrow-left-right',
  'income',
  'tracking',
  'Transfers between accounts and people where the net movement can be money received and money sent. Summaries use signed amounts so outgoing transfers reduce the category total.'
FROM workspaces w;
