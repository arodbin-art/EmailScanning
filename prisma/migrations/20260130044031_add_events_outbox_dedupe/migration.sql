SET search_path TO email_scanning;

ALTER TABLE events_outbox
  ADD COLUMN dedupe_key CHAR(32);

UPDATE events_outbox
  SET dedupe_key = md5(event_type || ':' || source_email_id::text)
  WHERE dedupe_key IS NULL;

ALTER TABLE events_outbox
  ALTER COLUMN dedupe_key SET NOT NULL;

CREATE UNIQUE INDEX events_outbox_dedupe_key_unique ON events_outbox (dedupe_key);
