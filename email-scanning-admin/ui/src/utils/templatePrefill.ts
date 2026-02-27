import { MonitorTemplate } from './types';

const EVENT_FAMILY_DEFAULTS: Record<string, string[]> = {
  'amazon.': ['amazon.return_requested', 'amazon.return_dropped_off', 'amazon.refund_issued'],
  'manulife.': [
    'manulife.claim_received',
    'manulife.claim_processed',
    'manulife.claim_paid',
    'manulife.claim_denied',
    'manulife.claim_info_required',
    'manulife.claim_status_update'
  ]
};

export type MonitorEditorDraft = {
  name: string;
  enabled: boolean;
  provider: string;
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

function mapEventFamilies(prefixes: string[] | null | undefined): string[] {
  if (!prefixes || prefixes.length === 0) {
    return [];
  }
  const output = new Set<string>();
  for (const prefix of prefixes) {
    const mapped = EVENT_FAMILY_DEFAULTS[prefix];
    if (mapped) {
      for (const eventType of mapped) {
        output.add(eventType);
      }
    }
  }
  return Array.from(output);
}

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
    sender_rules: defaults.sender_rules ?? [],
    subject_regex: defaults.subject_regex ?? '',
    body_regex: defaults.body_regex ?? '',
    allowed_event_types: mapEventFamilies(defaults.event_family_prefixes),
    scope: 'all',
    mail_account_ids: []
  };
}
