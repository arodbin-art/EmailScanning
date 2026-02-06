export type MailAccountRecord = {
  id: number;
  provider: string;
  account_label: string;
  mailbox_address: string;
  auth_type: string;
  enabled: boolean;
  created_at: string;
};

export type MonitorRecord = {
  id: string;
  name: string;
  enabled: boolean;
  provider: string;
  scope: 'all' | 'selected';
  mail_account_ids: number[] | null;
  sender_rules: unknown | null;
  from_contains: string | null;
  subject_contains: string | null;
  subject_regex: string | null;
  body_regex: string | null;
  has_attachments: boolean | null;
  gmail_label: string | null;
  ai_prompt_template: string | null;
  confidence_threshold: number | null;
  allowed_event_types: string[] | null;
  created_at: string;
  updated_at: string;
};

export type ValidationWarning = {
  code: string;
  message: string;
};
