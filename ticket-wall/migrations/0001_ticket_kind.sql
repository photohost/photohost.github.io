ALTER TABLE tickets ADD COLUMN kind TEXT CHECK (kind IN ('movie', 'drama'));
