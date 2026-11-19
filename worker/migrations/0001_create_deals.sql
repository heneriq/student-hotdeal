CREATE TABLE deals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  category TEXT NOT NULL,
  benefit TEXT NOT NULL,
  verification TEXT NOT NULL,
  address TEXT,
  ends TEXT,
  source TEXT,
  latitude REAL,
  longitude REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);

CREATE INDEX deals_visible_latest ON deals(hidden, created_at DESC, id DESC);
