ALTER TABLE diary_entries
ADD COLUMN generation_source TEXT CHECK (generation_source IN ('llm', 'deterministic', 'fallback'));

ALTER TABLE diary_entries
ADD COLUMN generation_user_model_json TEXT;

ALTER TABLE diary_entries
ADD COLUMN generation_source_fragment_ids_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE diary_entries
ADD COLUMN generation_keywords_json TEXT NOT NULL DEFAULT '[]';

