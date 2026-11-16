CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'accepted', 'rejected', 'delivery_uncertain')),
  decision TEXT CHECK (decision IS NULL OR decision IN ('accepted', 'rejected')),
  email_subject TEXT,
  email_body TEXT,
  email_provider_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS applications_created_at ON applications (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS application_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  templates_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at TEXT NOT NULL
);
