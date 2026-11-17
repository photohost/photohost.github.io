CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  title_zh TEXT NOT NULL DEFAULT '',
  title_original TEXT NOT NULL DEFAULT '',
  rating REAL,
  watched_on TEXT,
  poster_key TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS tickets_public_order
  ON tickets (status, watched_on DESC, published_at DESC);
