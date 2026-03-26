import { MonitorTemplate } from './types';

export type MonitorEditorDraft = {
  name: string;
  enabled: boolean;
  provider: string;
  capture_key: string;
  scope: 'all' | 'selected';
  mail_account_ids: number[];
  sender_rules: string[];
  from_contains: string;
  subject_contains: string;
  subject_regex: string;
  body_regex: string;
  has_attachments: null | boolean;
  gmail_label: string;
  ai_prompt_template: string;
  confidence_threshold: number;
  allowed_event_types: string[];
};

export function applyTemplateToDraft(
  draft: MonitorEditorDraft,
  template: MonitorTemplate
): MonitorEditorDraft {
  const defaults = template.monitor_defaults;
  return {
    ...draft,
    name: template.name,
    enabled: defaults.enabled ?? false,
    provider: defaults.provider,
    capture_key: defaults.capture_key ?? '',
    sender_rules: defaults.sender_rules ?? [],
    from_contains: defaults.from_contains ?? '',
    subject_contains: defaults.subject_contains ?? '',
    subject_regex: defaults.subject_regex ?? '',
    body_regex: defaults.body_regex ?? '',
    gmail_label: defaults.gmail_label ?? '',
    allowed_event_types: defaults.allowed_event_types ?? [],
    scope: 'all',
    mail_account_ids: []
  };
}
