import { applyTemplateToDraft, MonitorEditorDraft } from './templatePrefill.js';
import { MonitorTemplate } from './types.js';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const baseDraft: MonitorEditorDraft = {
  name: '',
  enabled: true,
  provider: '',
  scope: 'all',
  mail_account_ids: [],
  sender_rules: [],
  from_contains: '',
  subject_contains: '',
  subject_regex: '',
  body_regex: '',
  has_attachments: null,
  gmail_label: '',
  ai_prompt_template: '',
  confidence_threshold: 0.7,
  allowed_event_types: []
};

function testAmazonTemplatePrefill(): void {
  const template: MonitorTemplate = {
    id: 'amazon-default',
    name: 'Amazon (returns lifecycle)',
    description: 'Return requested, dropped off, refund issued',
    tags: ['amazon', 'returns'],
    version: '1.0.0',
    monitor_defaults: {
      provider: 'gmail',
      sender_rules: ['return@amazon.ca'],
      subject_regex: '.*',
      body_regex: null,
      event_family_prefixes: ['amazon.'],
      allowed_event_types: [
        'amazon.return_requested',
        'amazon.return_dropped_off',
        'amazon.refund_issued'
      ],
      enabled: false
    }
  };

  const draft = applyTemplateToDraft(baseDraft, template);
  assert(draft.name === 'Amazon (returns lifecycle)', 'name should be prefilled');
  assert(draft.provider === 'gmail', 'provider should be prefilled');
  assert(draft.enabled === false, 'enabled should follow template default');
  assert(draft.allowed_event_types.includes('amazon.refund_issued'), 'amazon event types should be mapped');
}

function testUnknownFamilyLeavesEventsBlank(): void {
  const template: MonitorTemplate = {
    id: 'orthodontics-template',
    name: 'Orthodontics',
    description: 'Unknown parser family',
    tags: ['orthodontics'],
    version: '1.0.0',
    monitor_defaults: {
      provider: 'gmail',
      event_family_prefixes: ['orthodontics.']
    }
  };

  const draft = applyTemplateToDraft(baseDraft, template);
  assert(draft.allowed_event_types.length === 0, 'missing allowed_event_types should default to empty');
}

function main(): void {
  testAmazonTemplatePrefill();
  testUnknownFamilyLeavesEventsBlank();
  console.log('templatePrefillTest ok');
}

main();
