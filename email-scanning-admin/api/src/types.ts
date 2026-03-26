export type MailAccountRecord = {
  id: number;
  provider: string;
  account_label: string;
  mailbox_address: string;
  auth_type: string;
  moneyrecovery_person_code: string | null;
  enabled: boolean;
  created_at: string;
};

export type MonitorRecord = {
  id: string;
  name: string;
  enabled: boolean;
  provider: string;
  capture_key: string | null;
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

export type EventsOutboxStatus = 'pending' | 'delivered' | 'needs_review' | 'rejected';

export type EventRecord = {
  id: number;
  status: EventsOutboxStatus;
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

export type FilterDraftSessionStatus =
  | 'draft'
  | 'questions_pending'
  | 'ready'
  | 'monitor_created'
  | 'cancelled';

export type FilterDraftQuestionRecord = {
  id: string;
  question_key: string;
  question_json: unknown;
  created_at: string;
  answered_at: string | null;
  answer_json: unknown | null;
};

export type FilterDraftProposalRecord = {
  id: string;
  proposal_json: unknown;
  analysis_json: unknown;
  confidence: number | null;
  created_monitor_id: string | null;
  created_at: string;
};

export type FilterDraftSampleRecord = {
  id: string;
  sample_index: number;
  source_kind: string;
  raw_source: string;
  filename: string | null;
  from_address: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  normalized_body: string;
  parsed_email_json: unknown | null;
  created_at: string;
  updated_at: string;
};

export type FilterDraftSessionRecord = {
  id: string;
  name: string;
  provider: string;
  scope: 'all' | 'selected';
  mail_account_ids: number[] | null;
  status: FilterDraftSessionStatus;
  analysis_provider: string;
  analysis_model: string | null;
  latest_confidence: number | null;
  latest_summary_json: unknown | null;
  monitor_id: string | null;
  created_at: string;
  updated_at: string;
  samples: FilterDraftSampleRecord[];
  questions: FilterDraftQuestionRecord[];
  latest_proposal: FilterDraftProposalRecord | null;
};
