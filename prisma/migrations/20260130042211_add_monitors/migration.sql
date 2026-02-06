SET search_path TO email_scanning;

CREATE TYPE monitor_scope AS ENUM ('all', 'selected');

CREATE TABLE monitors (
  id TEXT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  provider VARCHAR(50) NOT NULL,
  sender_rules JSONB,
  subject_regex TEXT,
  body_regex TEXT,
  scope monitor_scope NOT NULL DEFAULT 'all',
  mail_account_ids JSONB,
  ai_prompt_template TEXT NOT NULL,
  confidence_threshold NUMERIC(4, 3) NOT NULL,
  allowed_event_types JSONB NOT NULL,
  created_at TIMESTAMP(6) NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL
);
