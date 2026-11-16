CREATE TABLE IF NOT EXISTS application_notifications (
  application_id TEXT PRIMARY KEY REFERENCES applications(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'delivery_uncertain')),
  message_id TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  sent_at TEXT
);
