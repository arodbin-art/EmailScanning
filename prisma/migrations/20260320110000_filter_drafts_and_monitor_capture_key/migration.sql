SET search_path TO email_scanning;

ALTER TABLE monitors
  ADD COLUMN IF NOT EXISTS capture_key VARCHAR(120);

CREATE UNIQUE INDEX IF NOT EXISTS monitors_capture_key_unique
  ON monitors (LOWER(capture_key))
  WHERE capture_key IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'filter_draft_session_status'
      AND typnamespace = 'email_scanning'::regnamespace
  ) THEN
    CREATE TYPE filter_draft_session_status AS ENUM (
      'draft',
      'questions_pending',
      'ready',
      'monitor_created',
      'cancelled'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS filter_draft_sessions (
  id TEXT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  scope monitor_scope NOT NULL DEFAULT 'all',
  mail_account_ids JSONB,
  status filter_draft_session_status NOT NULL DEFAULT 'draft',
  analysis_provider VARCHAR(50) NOT NULL DEFAULT 'heuristic',
  analysis_model VARCHAR(120),
  latest_confidence NUMERIC(4, 3),
  latest_summary_json JSONB,
  monitor_id TEXT REFERENCES monitors(id),
  created_at TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS filter_draft_samples (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES filter_draft_sessions(id) ON DELETE CASCADE,
  sample_index SMALLINT NOT NULL,
  source_kind VARCHAR(30) NOT NULL,
  raw_source TEXT NOT NULL,
  filename TEXT,
  from_address TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  normalized_body TEXT NOT NULL,
  parsed_email_json JSONB,
  created_at TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT filter_draft_samples_session_index_unique UNIQUE (session_id, sample_index)
);

CREATE TABLE IF NOT EXISTS filter_draft_questions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES filter_draft_sessions(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  question_json JSONB NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  answered_at TIMESTAMP(6),
  CONSTRAINT filter_draft_questions_session_key_unique UNIQUE (session_id, question_key)
);

CREATE TABLE IF NOT EXISTS filter_draft_answers (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES filter_draft_sessions(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES filter_draft_questions(id) ON DELETE CASCADE,
  answer_json JSONB NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT filter_draft_answers_session_question_unique UNIQUE (session_id, question_id)
);

CREATE TABLE IF NOT EXISTS filter_draft_proposals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES filter_draft_sessions(id) ON DELETE CASCADE,
  proposal_json JSONB NOT NULL,
  analysis_json JSONB NOT NULL,
  confidence NUMERIC(4, 3),
  created_monitor_id TEXT REFERENCES monitors(id),
  created_at TIMESTAMP(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS filter_draft_sessions_status_idx
  ON filter_draft_sessions (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS filter_draft_samples_session_idx
  ON filter_draft_samples (session_id, sample_index);

CREATE INDEX IF NOT EXISTS filter_draft_questions_session_idx
  ON filter_draft_questions (session_id);

CREATE INDEX IF NOT EXISTS filter_draft_answers_session_idx
  ON filter_draft_answers (session_id);

CREATE INDEX IF NOT EXISTS filter_draft_proposals_session_idx
  ON filter_draft_proposals (session_id, created_at DESC);
