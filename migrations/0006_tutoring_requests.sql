CREATE TABLE IF NOT EXISTS tutoring_requests (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  relationship TEXT NOT NULL CHECK (relationship IN ('Student', 'Parent or guardian', 'Educator')),
  grade TEXT NOT NULL CHECK (grade IN ('Grades K–2', 'Grades 3–5', 'Grades 6–8', 'Grades 9–12', 'Other')),
  subjects TEXT NOT NULL,
  needs TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('Online', 'In person', 'Either')),
  city TEXT NOT NULL DEFAULT '',
  availability TEXT NOT NULL DEFAULT '',
  consent INTEGER NOT NULL CHECK (consent = 1),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status = 'new'),
  created_at TEXT NOT NULL,
  notification_status TEXT NOT NULL DEFAULT 'pending' CHECK (notification_status IN ('pending', 'sending', 'sent', 'failed', 'delivery_uncertain')),
  notification_message_id TEXT,
  notification_error TEXT,
  notification_updated_at TEXT NOT NULL,
  notification_sent_at TEXT
);
CREATE INDEX IF NOT EXISTS tutoring_requests_created_at ON tutoring_requests (created_at DESC, id DESC);
