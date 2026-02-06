ALTER TABLE email_scanning.monitors
  ADD COLUMN IF NOT EXISTS from_contains TEXT,
  ADD COLUMN IF NOT EXISTS subject_contains TEXT,
  ADD COLUMN IF NOT EXISTS has_attachments BOOLEAN,
  ADD COLUMN IF NOT EXISTS gmail_label TEXT;

ALTER TABLE email_scanning.monitors
  ALTER COLUMN ai_prompt_template DROP NOT NULL,
  ALTER COLUMN confidence_threshold DROP NOT NULL,
  ALTER COLUMN allowed_event_types DROP NOT NULL;

CREATE TABLE IF NOT EXISTS email_scanning.monitor_matches (
  email_id INTEGER NOT NULL REFERENCES email_scanning.emails_raw(id) ON DELETE CASCADE,
  monitor_id TEXT NOT NULL REFERENCES email_scanning.monitors(id) ON DELETE CASCADE,
  matched_at TIMESTAMP(6) NOT NULL,
  matched_fields JSONB NOT NULL,
  PRIMARY KEY (email_id, monitor_id)
);
