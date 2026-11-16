CREATE TABLE IF NOT EXISTS site_content (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  content_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at TEXT NOT NULL
);
