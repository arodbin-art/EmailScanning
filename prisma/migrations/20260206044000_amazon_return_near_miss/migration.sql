CREATE TABLE IF NOT EXISTS email_scanning.amazon_return_near_miss (
  email_id INTEGER PRIMARY KEY REFERENCES email_scanning.emails_raw(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  from_address TEXT NOT NULL,
  subject TEXT,
  received_at TIMESTAMP(6) NOT NULL,
  order_id TEXT,
  expected_event_type VARCHAR(100),
  missing_fields JSONB,
  reason VARCHAR(100) NOT NULL,
  snippet TEXT,
  ai_suggestion JSONB,
  created_at TIMESTAMP(6) NOT NULL
);
