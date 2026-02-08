CREATE TABLE IF NOT EXISTS diary_entry_revisions (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('generated', 'saved', 'confirmed')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (entry_id) REFERENCES diary_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_diary_entry_revisions_entry_id_created_at
  ON diary_entry_revisions(entry_id, created_at);

