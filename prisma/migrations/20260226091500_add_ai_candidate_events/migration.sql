SET search_path TO email_scanning;

CREATE TABLE IF NOT EXISTS ai_candidate_events (
  id TEXT PRIMARY KEY,
  email_id TEXT NOT NULL,
  provider VARCHAR(50) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  primary_ref TEXT,
  amount NUMERIC(12, 2),
  occurred_at TIMESTAMP(6),
  payload_json JSONB NOT NULL,
  confidence DOUBLE PRECISION,
  created_at TIMESTAMP(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_candidate_events_email_id
  ON ai_candidate_events (email_id);
