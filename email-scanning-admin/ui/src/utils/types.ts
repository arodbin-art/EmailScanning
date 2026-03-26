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
    capture_key?: string | null;
    sender_rules?: string[] | null;
    from_contains?: string | null;
    subject_contains?: string | null;
    subject_regex?: string | null;
    body_regex?: string | null;
    gmail_label?: string | null;
    event_family_prefixes?: string[] | null;
    allowed_event_types?: string[] | null;
    enabled?: boolean;
  };
};

export type FilterDraftQuestion = {
  id: string;
  question: string;
  reason: string;
  answer_type: 'text' | 'single_select' | 'boolean';
  options?: string[];
  required: boolean;
};

export type FilterDraftProposal = {
  name: string;
  capture_key: string | null;
  enabled: boolean;
  provider: string;
  scope: 'all' | 'selected';
  mail_account_ids: number[] | null;
  sender_rules: Array<{ type: 'exact' | 'domain' | 'regex'; value: string }> | null;
  from_contains: string | null;
  subject_contains: string | null;
  subject_regex: string | null;
  body_regex: string | null;
  has_attachments: boolean | null;
  gmail_label: string | null;
  ai_prompt_template: string | null;
  confidence_threshold: number | null;
  allowed_event_types: string[] | null;
  parser_family_guess: string | null;
  event_type_guess: string | null;
  human_title_source: string | null;
  description_source: string | null;
  attachment_relevance: 'required' | 'optional' | 'none' | 'unknown';
  confidence: number;
  notes: string[];
};

export type FilterDraftSession = {
  id: string;
  name: string;
  provider: string;
  scope: 'all' | 'selected';
  mail_account_ids: number[] | null;
  status: 'draft' | 'questions_pending' | 'ready' | 'monitor_created' | 'cancelled';
  analysis_provider: string;
  analysis_model: string | null;
  latest_confidence: number | null;
  latest_summary_json: {
    monitor_name_suggestion: string;
    capture_key_suggestion: string | null;
    sender_rules: Array<{ type: 'exact' | 'domain' | 'regex'; value: string }>;
    subject_regex: string | null;
    body_regex: string | null;
    parser_family_guess: string | null;
    event_type_guess: string | null;
    title_source_guess: string | null;
    description_source_guess: string | null;
    fields_detected: Array<{
      field: string;
      value: string;
      source: string;
      confidence: number;
    }>;
    variable_tokens: string[];
    stable_tokens: string[];
    attachment_relevance: 'required' | 'optional' | 'none' | 'unknown';
    questions: FilterDraftQuestion[];
    confidence: number;
    notes: string[];
  } | null;
  monitor_id: string | null;
  created_at: string;
  updated_at: string;
  samples: Array<{
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
    created_at: string;
    updated_at: string;
  }>;
  questions: Array<{
    id: string;
    question_key: string;
    question_json: FilterDraftQuestion;
    answer_json: { value?: string | boolean } | null;
  }>;
  latest_proposal: {
    id: string;
    proposal_json: FilterDraftProposal;
    analysis_json: unknown;
    confidence: number | null;
    created_monitor_id: string | null;
    created_at: string;
  } | null;
};
