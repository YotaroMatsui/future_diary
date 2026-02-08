ALTER TABLE diary_entries
ADD COLUMN generation_status TEXT NOT NULL DEFAULT 'completed' CHECK (generation_status IN ('created', 'processing', 'failed', 'completed'));

ALTER TABLE diary_entries
ADD COLUMN generation_error TEXT;

