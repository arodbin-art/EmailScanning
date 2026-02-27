export type MailAccount = {
  id: number;
  provider: string;
  account_label: string;
  mailbox_address: string;
  auth_type: string;
  moneyrecovery_person_code: string | null;
  enabled: boolean;
  created_at: string;
};

export type Monitor = {
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

export type EventStatus = 'pending' | 'delivered' | 'needs_review' | 'rejected';

export type SignalEvent = {
  id: number;
  status: EventStatus;
  event_type: string;
  created_at: string;
  confidence: number | null;
  source_email_id: number;
  payload_json: unknown;
  email_subject: string | null;
  email_from: string | null;
  email_received_at: string | null;
  delivered_at: string | null;
  rvi_response: unknown | null;
};

export type TemplateSummary = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  version: string;
};

export type MonitorTemplate = TemplateSummary & {
  monitor_defaults: {
    provider: string;
    sender_rules?: string[] | null;
    subject_regex?: string | null;
    body_regex?: string | null;
    event_family_prefixes?: string[] | null;
    enabled?: boolean;
  };
};
