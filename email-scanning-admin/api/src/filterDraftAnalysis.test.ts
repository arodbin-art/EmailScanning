import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFilterDraftProposal,
  buildHeuristicDraftAnalysis,
  normalizeFilterDraftSample,
  validateAiAnalysisPayload
} from './filterDraftAnalysis.js';
import { filterDraftSamplesPayloadSchema } from './validation.js';

const session = {
  name: 'MobilityRoom draft',
  provider: 'gmail',
  scope: 'selected' as const,
  mail_account_ids: [1]
};

test('sample payload validation rejects malformed structured sample', () => {
  assert.throws(() =>
    filterDraftSamplesPayloadSchema.parse({
      samples: [{ sample_index: 1, source_kind: 'structured', subject: 'Missing fields' }]
    })
  );
});

test('ai analysis payload validation enforces strict shape', () => {
  assert.throws(() =>
    validateAiAnalysisPayload({
      monitor_name_suggestion: 'Bad payload'
    })
  );
});

test('heuristic analysis compares two samples into stable and variable patterns', () => {
  const samples = [
    normalizeFilterDraftSample({
      sample_index: 1,
      source_kind: 'structured',
      from: 'notifications@mobilityroom.com',
      subject: 'MobilityRoom order MR-1001 approved',
      body_text:
        'MobilityRoom order MR-1001 for John Smith was approved on 2026-03-18. Amount: CAD 125.00.'
    }),
    normalizeFilterDraftSample({
      sample_index: 2,
      source_kind: 'structured',
      from: 'notifications@mobilityroom.com',
      subject: 'MobilityRoom order MR-1002 approved',
      body_text:
        'MobilityRoom order MR-1002 for Jane Smith was approved on 2026-03-19. Amount: CAD 135.00.'
    })
  ];

  const analysis = buildHeuristicDraftAnalysis({ session, samples });
  assert.equal(analysis.sender_rules[0]?.value, 'notifications@mobilityroom.com');
  assert.ok(analysis.stable_tokens.includes('mobilityroom'));
  assert.ok(analysis.variable_tokens.includes('john') || analysis.variable_tokens.includes('jane'));
  assert.ok(analysis.fields_detected.some((field) => field.field === 'reference_id'));
});

test('question generation stays targeted and structured', () => {
  const samples = [
    normalizeFilterDraftSample({
      sample_index: 1,
      source_kind: 'structured',
      from: 'team@example.com',
      subject: 'Receipt RX-123 and claim CLM-456',
      body_text: 'Dates: 2026-03-18 and 2026-03-20. Attachment invoice.pdf included.'
    })
  ];
  const analysis = buildHeuristicDraftAnalysis({ session, samples });
  assert.ok(analysis.questions.length <= 3, 'question count should stay low');
  assert.ok(
    analysis.questions.every((question) => typeof question.id === 'string' && question.id.length > 0),
    'questions should be structured'
  );
});

test('proposal mapping keeps low-confidence regexes safe and monitor disabled', () => {
  const samples = [
    normalizeFilterDraftSample({
      sample_index: 1,
      source_kind: 'structured',
      from: 'hello@random-source.com',
      subject: 'Notification',
      body_text: 'A single ambiguous sample with no strong anchors.'
    })
  ];
  const analysis = buildHeuristicDraftAnalysis({ session, samples });
  const proposal = buildFilterDraftProposal({ session, analysis });
  assert.equal(proposal.enabled, false);
  if (analysis.confidence < 0.7) {
    assert.equal(proposal.body_regex, null);
  }
});
