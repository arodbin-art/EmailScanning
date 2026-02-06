CREATE TABLE IF NOT EXISTS email_scanning.amazon_refund_processed (
  order_id TEXT PRIMARY KEY,
  email_id INTEGER REFERENCES email_scanning.emails_raw(id) ON DELETE SET NULL,
  processed_at TIMESTAMP(6) NOT NULL
);

CREATE TABLE IF NOT EXISTS email_scanning.amazon_refund_discrepancies (
  id SERIAL PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  email_id INTEGER NOT NULL REFERENCES email_scanning.emails_raw(id) ON DELETE CASCADE,
  charged_amount NUMERIC(10, 2) NOT NULL,
  refunded_amount NUMERIC(10, 2) NOT NULL,
  difference NUMERIC(10, 2) NOT NULL,
  subject TEXT,
  received_at TIMESTAMP(6) NOT NULL,
  gmail_link TEXT,
  created_at TIMESTAMP(6) NOT NULL
);
