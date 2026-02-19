SET search_path TO email_scanning;

ALTER TYPE events_outbox_status ADD VALUE IF NOT EXISTS 'needs_review';

ALTER TABLE mail_accounts
  ADD COLUMN IF NOT EXISTS moneyrecovery_person_code TEXT;

CREATE INDEX IF NOT EXISTS idx_mail_accounts_moneyrecovery_person_code
  ON mail_accounts (moneyrecovery_person_code);
