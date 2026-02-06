CREATE SCHEMA IF NOT EXISTS email_scanning;

SET search_path TO email_scanning;

CREATE TYPE email_monitor_status_state AS ENUM ('ignored', 'processed', 'errored');
CREATE TYPE events_outbox_status AS ENUM ('pending', 'delivered', 'rejected');

CREATE TABLE mail_accounts (
  id SERIAL PRIMARY KEY,
  provider VARCHAR(50) NOT NULL,
  account_label VARCHAR(100) NOT NULL,
  mailbox_address VARCHAR(320) NOT NULL,
  auth_type VARCHAR(50) NOT NULL,
  encrypted_credentials_ref TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP(6) NOT NULL
);

CREATE TABLE emails_raw (
  id SERIAL PRIMARY KEY,
  mail_account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE RESTRICT,
  provider VARCHAR(50) NOT NULL,
  message_id TEXT NOT NULL,
  thread_id TEXT,
  from_address TEXT NOT NULL,
  subject TEXT,
  received_at TIMESTAMP(6) NOT NULL,
  body_hash CHAR(64) NOT NULL,
  body_object_key TEXT NOT NULL,
  attachment_metadata JSONB,
  first_seen_at TIMESTAMP(6) NOT NULL,
  last_seen_at TIMESTAMP(6) NOT NULL,
  CONSTRAINT emails_raw_mail_account_message_id_unique UNIQUE (mail_account_id, message_id)
);

CREATE TABLE email_monitor_status (
  email_id INTEGER NOT NULL REFERENCES emails_raw(id) ON DELETE CASCADE,
  monitor_id TEXT NOT NULL,
  status email_monitor_status_state NOT NULL,
  evaluated_at TIMESTAMP(6) NOT NULL,
  PRIMARY KEY (email_id, monitor_id)
);

CREATE TABLE ai_inference_runs (
  id SERIAL PRIMARY KEY,
  email_id INTEGER NOT NULL REFERENCES emails_raw(id) ON DELETE CASCADE,
  monitor_id TEXT NOT NULL,
  model_name VARCHAR(100) NOT NULL,
  prompt_version VARCHAR(50) NOT NULL,
  output_json JSONB NOT NULL,
  confidence NUMERIC(4, 3) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL
);

CREATE TABLE events_outbox (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  payload_json JSONB NOT NULL,
  source_email_id INTEGER NOT NULL REFERENCES emails_raw(id) ON DELETE RESTRICT,
  confidence NUMERIC(4, 3) NOT NULL,
  status events_outbox_status NOT NULL,
  created_at TIMESTAMP(6) NOT NULL
);

CREATE TABLE events_delivery_log (
  event_id INTEGER NOT NULL REFERENCES events_outbox(id) ON DELETE CASCADE,
  rvi_response JSONB NOT NULL,
  delivered_at TIMESTAMP(6) NOT NULL,
  PRIMARY KEY (event_id, delivered_at)
);
