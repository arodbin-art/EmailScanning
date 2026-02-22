CREATE TABLE IF NOT EXISTS email_scanning.manulife_claim_near_miss (
  email_id INTEGER PRIMARY KEY REFERENCES email_scanning.emails_raw(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  from_address TEXT NOT NULL,
  subject TEXT,
  received_at TIMESTAMP(6) NOT NULL,
  claim_id TEXT,
  status_text TEXT,
  parse_reason VARCHAR(120) NOT NULL,
  extracted_candidates JSONB,
  ai_suggestion_json JSONB,
  snippet TEXT,
  created_at TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_manulife_claim_near_miss_received_at
  ON email_scanning.manulife_claim_near_miss (received_at DESC);
