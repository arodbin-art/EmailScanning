import { z } from 'zod';

const knownParserFamilies = ['amazon', 'manulife', 'orthodontics'] as const;
const parserFamilyEnumValues = ['amazon', 'manulife', 'orthodontics', 'generic_ai', 'unknown'] as const;

export const senderRuleSchema = z.object({
  type: z.enum(['exact', 'domain', 'regex']),
  value: z.string().min(1)
});

export const filterDraftQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  reason: z.string().min(1),
  answer_type: z.enum(['text', 'single_select', 'boolean']),
  options: z.array(z.string().min(1)).optional(),
  required: z.boolean()
});

export const filterDraftFieldSchema = z.object({
  field: z.enum([
    'sender',
    'subject_anchor',
    'body_anchor',
    'reference_id',
    'amount',
    'date',
    'title_candidate',
    'description_candidate'
  ]),
  value: z.string().min(1),
  source: z.enum(['from_address', 'subject', 'body']),
  confidence: z.number().min(0).max(1)
});

export const filterDraftAnalysisSchema = z.object({
  monitor_name_suggestion: z.string().min(1),
  capture_key_suggestion: z.string().min(1).nullable(),
  sender_rules: z.array(senderRuleSchema),
  subject_regex: z.string().min(1).nullable(),
  body_regex: z.string().min(1).nullable(),
  parser_family_guess: z.enum(parserFamilyEnumValues).nullable(),
  event_type_guess: z.string().min(1).nullable(),
  title_source_guess: z.string().min(1).nullable(),
  description_source_guess: z.string().min(1).nullable(),
  fields_detected: z.array(filterDraftFieldSchema),
  variable_tokens: z.array(z.string().min(1)),
  stable_tokens: z.array(z.string().min(1)),
  attachment_relevance: z.enum(['required', 'optional', 'none', 'unknown']),
  questions: z.array(filterDraftQuestionSchema).max(3),
  confidence: z.number().min(0).max(1),
  notes: z.array(z.string().min(1))
});

export const filterDraftProposalSchema = z.object({
  name: z.string().min(1).max(200),
  capture_key: z.string().min(1).max(120).nullable(),
  enabled: z.boolean(),
  provider: z.string().min(1).max(50),
  scope: z.enum(['all', 'selected']),
  mail_account_ids: z.array(z.number().int().positive()).nullable(),
  sender_rules: z.array(senderRuleSchema).nullable(),
  from_contains: z.string().min(1).nullable(),
  subject_contains: z.string().min(1).nullable(),
  subject_regex: z.string().min(1).nullable(),
  body_regex: z.string().min(1).nullable(),
  has_attachments: z.boolean().nullable(),
  gmail_label: z.string().min(1).nullable(),
  ai_prompt_template: z.string().min(1).nullable(),
  confidence_threshold: z.number().min(0).max(1).nullable(),
  allowed_event_types: z.array(z.string().min(1)).nullable(),
  parser_family_guess: z.string().min(1).nullable(),
  event_type_guess: z.string().min(1).nullable(),
  human_title_source: z.string().min(1).nullable(),
  description_source: z.string().min(1).nullable(),
  attachment_relevance: z.enum(['required', 'optional', 'none', 'unknown']),
  confidence: z.number().min(0).max(1),
  notes: z.array(z.string().min(1))
});

export type SenderRule = z.infer<typeof senderRuleSchema>;
export type FilterDraftQuestion = z.infer<typeof filterDraftQuestionSchema>;
export type FilterDraftField = z.infer<typeof filterDraftFieldSchema>;
export type FilterDraftAnalysis = z.infer<typeof filterDraftAnalysisSchema>;
export type FilterDraftProposal = z.infer<typeof filterDraftProposalSchema>;

export type FilterDraftAnswerMap = Record<string, unknown>;

export type FilterDraftSessionInput = {
  name: string;
  provider: string;
  scope: 'all' | 'selected';
  mail_account_ids: number[];
};

export type NormalizedFilterDraftSample = {
  sample_index: number;
  source_kind: 'structured' | 'raw_email' | 'eml';
  raw_source: string;
  filename: string | null;
  from_address: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  normalized_body: string;
  parsed_email_json: Record<string, unknown>;
};

export type FilterDraftSampleInput = {
  sample_index: number;
  source_kind: 'structured' | 'raw_email' | 'eml';
  raw_email?: string | null;
  raw_source?: string | null;
  filename?: string | null;
  from?: string | null;
  subject?: string | null;
  body_text?: string | null;
  body_html?: string | null;
};

export function normalizeFilterDraftSample(input: FilterDraftSampleInput): NormalizedFilterDraftSample {
  const filename = normalizeString(input.filename);
  const rawSource = normalizeString(input.raw_source) ?? normalizeString(input.raw_email) ?? '';
  const normalizedSourceKind = input.source_kind;

  const parsed =
    normalizedSourceKind === 'structured'
      ? {
          from_address: normalizeString(input.from) ?? '',
          subject: normalizeString(input.subject) ?? '',
          body_text: normalizeString(input.body_text) ?? '',
          body_html: normalizeString(input.body_html),
          raw_source:
            rawSource ||
            JSON.stringify(
              {
                from: normalizeString(input.from) ?? '',
                subject: normalizeString(input.subject) ?? '',
                body_text: normalizeString(input.body_text) ?? '',
                body_html: normalizeString(input.body_html) ?? null
              },
              null,
              2
            )
        }
      : parseRawEmailSource(rawSource);

  const normalizedBody = normalizeBodyText(parsed.body_html ?? parsed.body_text);

  return {
    sample_index: input.sample_index,
    source_kind: normalizedSourceKind,
    raw_source: parsed.raw_source,
    filename,
    from_address: parsed.from_address,
    subject: parsed.subject,
    body_text: parsed.body_text,
    body_html: parsed.body_html ?? null,
    normalized_body: normalizedBody,
    parsed_email_json: {
      from_address: parsed.from_address,
      subject: parsed.subject,
      body_text: parsed.body_text,
      body_html: parsed.body_html ?? null,
      normalized_body: normalizedBody,
      filename
    }
  };
}

export function normalizeCaptureKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  return normalized.length > 0 ? normalized.slice(0, 120) : null;
}

export function validateAiAnalysisPayload(value: unknown): FilterDraftAnalysis {
  return filterDraftAnalysisSchema.parse(value);
}

export function buildHeuristicDraftAnalysis(params: {
  session: FilterDraftSessionInput;
  samples: NormalizedFilterDraftSample[];
  answers?: FilterDraftAnswerMap;
}): FilterDraftAnalysis {
  const answers = params.answers ?? {};
  const samples = params.samples.slice().sort((a, b) => a.sample_index - b.sample_index);
  const first = samples[0];
  if (!first) {
    throw new Error('At least one sample is required for analysis');
  }

  const senderRules = buildSenderRules(samples);
  const stableTokens = buildStableTokens(samples);
  const variableTokens = buildVariableTokens(samples, stableTokens);
  const fieldsDetected = detectFields(samples, stableTokens);
  const parserFamilyGuess = guessParserFamily(samples);
  const eventTypeGuess = guessEventType(parserFamilyGuess, fieldsDetected, answers);
  const titleSourceGuess = guessTitleSource(samples, parserFamilyGuess);
  const descriptionSourceGuess = guessDescriptionSource(titleSourceGuess, parserFamilyGuess);
  const subjectRegex = buildAnchorRegex(samples.map((sample) => sample.subject), 2);
  const bodyRegex = buildAnchorRegex(samples.map((sample) => sample.normalized_body), 3);
  const attachmentRelevance = guessAttachmentRelevance(samples, answers);

  const notes: string[] = [];
  if (samples.length === 1) {
    notes.push('Only one sample is available; stable vs variable token detection is limited.');
  }
  if (!subjectRegex) {
    notes.push('Subject regex omitted because the stable subject anchors were too weak.');
  }
  if (!bodyRegex) {
    notes.push('Body regex omitted because the stable body anchors were too weak.');
  }
  if (parserFamilyGuess === 'unknown') {
    notes.push('No existing parser family matched strongly; proposal will stay disabled by default.');
  }

  const confidence = clamp01(
    0.35 +
      (senderRules.length > 0 ? 0.15 : 0) +
      (subjectRegex ? 0.1 : 0) +
      (bodyRegex ? 0.1 : 0) +
      (parserFamilyGuess && parserFamilyGuess !== 'unknown' ? 0.15 : 0) +
      (fieldsDetected.length >= 3 ? 0.1 : 0) +
      (samples.length > 1 ? 0.05 : 0)
  );

  const questions = buildQuestions({
    answers,
    fieldsDetected,
    attachmentRelevance,
    parserFamilyGuess,
    samples
  });

  return {
    monitor_name_suggestion: buildMonitorNameSuggestion(params.session.name, titleSourceGuess, parserFamilyGuess),
    capture_key_suggestion: normalizeCaptureKey(
      params.session.name || descriptionSourceGuess || titleSourceGuess || `${first.subject || 'email'}_draft`
    ),
    sender_rules: senderRules,
    subject_regex: subjectRegex,
    body_regex: bodyRegex,
    parser_family_guess: parserFamilyGuess,
    event_type_guess: eventTypeGuess,
    title_source_guess: titleSourceGuess,
    description_source_guess: descriptionSourceGuess,
    fields_detected: fieldsDetected,
    variable_tokens: variableTokens.slice(0, 16),
    stable_tokens: stableTokens.slice(0, 16),
    attachment_relevance: attachmentRelevance,
    questions,
    confidence,
    notes
  };
}

export function buildFilterDraftProposal(params: {
  session: FilterDraftSessionInput;
  analysis: FilterDraftAnalysis;
  answers?: FilterDraftAnswerMap;
}): FilterDraftProposal {
  const answers = params.answers ?? {};
  const parserFamily = params.analysis.parser_family_guess;
  const eventDisposition = normalizeString(answers.event_disposition);
  const allowedEventTypes = selectAllowedEventTypes(parserFamily, params.analysis.event_type_guess, eventDisposition);
  const shouldDisable =
    params.analysis.confidence < 0.75 ||
    !!params.analysis.questions.find((question) => question.required && answers[question.id] === undefined);

  const attachmentRequiredAnswer = parseBooleanAnswer(answers.attachment_required);
  const subjectRegex = params.analysis.confidence >= 0.65 ? params.analysis.subject_regex : null;
  const bodyRegex = params.analysis.confidence >= 0.7 ? params.analysis.body_regex : null;

  const notes = [...params.analysis.notes];
  if (shouldDisable) {
    notes.push('Monitor will be created disabled until the draft is reviewed.');
  }
  if (!allowedEventTypes) {
    notes.push('No event family was selected with enough confidence, so allowed event types were left blank.');
  }

  return filterDraftProposalSchema.parse({
    name: params.analysis.monitor_name_suggestion,
    capture_key: normalizeCaptureKey(
      normalizeString(answers.capture_key) ?? params.analysis.capture_key_suggestion
    ),
    enabled: false,
    provider: params.session.provider,
    scope: params.session.scope,
    mail_account_ids:
      params.session.scope === 'selected' ? Array.from(new Set(params.session.mail_account_ids)) : null,
    sender_rules: params.analysis.sender_rules.length > 0 ? params.analysis.sender_rules : null,
    from_contains: null,
    subject_contains: null,
    subject_regex: subjectRegex,
    body_regex: bodyRegex,
    has_attachments:
      attachmentRequiredAnswer !== null
        ? attachmentRequiredAnswer
        : params.analysis.attachment_relevance === 'required'
        ? true
        : params.analysis.attachment_relevance === 'none'
        ? false
        : null,
    gmail_label: null,
    ai_prompt_template:
      parserFamily === 'generic_ai'
        ? buildGenericAiPrompt(params.analysis, answers)
        : null,
    confidence_threshold: shouldDisable ? 0.8 : 0.7,
    allowed_event_types: allowedEventTypes,
    parser_family_guess: parserFamily,
    event_type_guess: params.analysis.event_type_guess,
    human_title_source: params.analysis.title_source_guess,
    description_source: params.analysis.description_source_guess,
    attachment_relevance: params.analysis.attachment_relevance,
    confidence: params.analysis.confidence,
    notes
  });
}

function parseRawEmailSource(rawSource: string): {
  from_address: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  raw_source: string;
} {
  const normalized = rawSource.replace(/\r\n/g, '\n');
  const [rawHeaders, ...rawBodyParts] = normalized.split('\n\n');
  const rawBody = rawBodyParts.join('\n\n').trim();
  const headerMap = new Map<string, string>();
  let currentHeader: string | null = null;

  for (const line of rawHeaders.split('\n')) {
    if (/^\s/.test(line) && currentHeader) {
      headerMap.set(currentHeader, `${headerMap.get(currentHeader) ?? ''} ${line.trim()}`.trim());
      continue;
    }
    const separator = line.indexOf(':');
    if (separator === -1) {
      currentHeader = null;
      continue;
    }
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headerMap.set(key, value);
    currentHeader = key;
  }

  const htmlMatch = rawBody.match(/<html[\s\S]*<\/html>/i);
  const bodyHtml = htmlMatch ? htmlMatch[0] : null;
  const bodyText = bodyHtml ? normalizeHtmlToText(bodyHtml) : rawBody;

  return {
    from_address: headerMap.get('from') ?? '',
    subject: headerMap.get('subject') ?? '',
    body_text: bodyText,
    body_html: bodyHtml,
    raw_source: rawSource
  };
}

function buildSenderRules(samples: NormalizedFilterDraftSample[]): SenderRule[] {
  const fromAddresses = Array.from(
    new Set(samples.map((sample) => sample.from_address.trim()).filter((value) => value.length > 0))
  );
  if (fromAddresses.length === 1) {
    return [{ type: 'exact', value: fromAddresses[0]! }];
  }

  const domains = Array.from(
    new Set(
      samples
        .map((sample) => sample.from_address.toLowerCase().split('@')[1] ?? '')
        .filter((value) => value.length > 0)
    )
  );
  if (domains.length === 1) {
    return [{ type: 'domain', value: domains[0]! }];
  }
  return [];
}

function buildStableTokens(samples: NormalizedFilterDraftSample[]): string[] {
  const tokenLists = samples.map((sample) => informativeTokens(`${sample.subject}\n${sample.normalized_body}`));
  if (tokenLists.length === 0) return [];
  const counts = new Map<string, number>();
  for (const tokenSet of tokenLists.map((tokens) => new Set(tokens))) {
    for (const token of tokenSet) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  const requiredCount = tokenLists.length;
  return tokenLists[0]!.filter((token, index, source) => {
    return counts.get(token) === requiredCount && source.indexOf(token) === index;
  });
}

function buildVariableTokens(samples: NormalizedFilterDraftSample[], stableTokens: string[]): string[] {
  const stable = new Set(stableTokens);
  const tokens: string[] = [];
  for (const sample of samples) {
    for (const token of informativeTokens(`${sample.subject}\n${sample.normalized_body}`)) {
      if (!stable.has(token) && !tokens.includes(token)) {
        tokens.push(token);
      }
    }
  }
  return tokens;
}

function detectFields(samples: NormalizedFilterDraftSample[], stableTokens: string[]): FilterDraftField[] {
  const results: FilterDraftField[] = [];
  const pushIfMissing = (field: FilterDraftField) => {
    if (!results.find((entry) => entry.field === field.field && entry.value === field.value)) {
      results.push(field);
    }
  };

  for (const sample of samples) {
    if (sample.from_address) {
      pushIfMissing({
        field: 'sender',
        value: sample.from_address,
        source: 'from_address',
        confidence: 0.99
      });
    }

    for (const amount of extractAmounts(sample.subject, sample.normalized_body)) {
      pushIfMissing({
        field: 'amount',
        value: amount,
        source: sample.subject.includes(amount) ? 'subject' : 'body',
        confidence: 0.84
      });
    }

    for (const ref of extractReferenceIds(sample.subject, sample.normalized_body)) {
      pushIfMissing({
        field: 'reference_id',
        value: ref,
        source: sample.subject.includes(ref) ? 'subject' : 'body',
        confidence: 0.78
      });
    }

    for (const date of extractDates(sample.subject, sample.normalized_body)) {
      pushIfMissing({
        field: 'date',
        value: date,
        source: sample.subject.includes(date) ? 'subject' : 'body',
        confidence: 0.74
      });
    }
  }

  for (const token of stableTokens.slice(0, 4)) {
    pushIfMissing({
      field: 'body_anchor',
      value: token,
      source: 'body',
      confidence: 0.6
    });
  }

  return results;
}

function guessParserFamily(samples: NormalizedFilterDraftSample[]): FilterDraftAnalysis['parser_family_guess'] {
  const combined = samples
    .map((sample) => `${sample.from_address}\n${sample.subject}\n${sample.normalized_body}`.toLowerCase())
    .join('\n');
  if (combined.includes('amazon') || combined.includes('return requested') || combined.includes('refund issued')) {
    return 'amazon';
  }
  if (combined.includes('manulife') || combined.includes('claim')) {
    return 'manulife';
  }
  if (combined.includes('durham orthodontics') || combined.includes('elavon')) {
    return 'orthodontics';
  }
  if (combined.includes('invoice') || combined.includes('payment') || combined.includes('approved')) {
    return 'generic_ai';
  }
  return 'unknown';
}

function guessEventType(
  parserFamily: FilterDraftAnalysis['parser_family_guess'],
  fields: FilterDraftField[],
  answers: FilterDraftAnswerMap
): string | null {
  const explicit = normalizeString(answers.event_type);
  if (explicit) return explicit;
  if (parserFamily === 'amazon') {
    if (fields.some((field) => field.field === 'amount')) {
      return 'amazon.return_requested';
    }
    return 'amazon.refund_issued';
  }
  if (parserFamily === 'manulife') {
    return 'manulife.claim_received';
  }
  if (parserFamily === 'orthodontics') {
    return 'orthodontics.payment_approved';
  }
  return null;
}

function guessTitleSource(
  samples: NormalizedFilterDraftSample[],
  parserFamily: FilterDraftAnalysis['parser_family_guess']
): string | null {
  if (parserFamily === 'orthodontics') {
    return 'Durham Orthodontics Ajax';
  }
  if (parserFamily === 'manulife') {
    return 'Manulife';
  }
  if (parserFamily === 'amazon') {
    return 'Amazon';
  }

  const firstSender = samples[0]?.from_address ?? '';
  const domain = firstSender.split('@')[1] ?? '';
  if (domain) {
    const firstSegment = domain.split('.')[0] ?? '';
    if (firstSegment) {
      return firstSegment
        .split(/[-_]+/)
        .map((segment) => (segment ? segment[0]!.toUpperCase() + segment.slice(1) : ''))
        .join(' ')
        .trim();
    }
  }

  const firstSubject = samples[0]?.subject ?? '';
  const titleMatch = firstSubject.match(/[A-Z][A-Za-z0-9&' -]{3,}/);
  return titleMatch?.[0]?.trim() ?? null;
}

function guessDescriptionSource(
  titleSourceGuess: string | null,
  parserFamily: FilterDraftAnalysis['parser_family_guess']
): string | null {
  if (titleSourceGuess) {
    return titleSourceGuess;
  }
  if (parserFamily === 'generic_ai') {
    return 'Entity name from sender or body';
  }
  return null;
}

function guessAttachmentRelevance(
  samples: NormalizedFilterDraftSample[],
  answers: FilterDraftAnswerMap
): FilterDraftAnalysis['attachment_relevance'] {
  const answered = parseBooleanAnswer(answers.attachment_required);
  if (answered === true) return 'required';
  if (answered === false) return 'none';

  const combined = samples.map((sample) => sample.raw_source.toLowerCase()).join('\n');
  if (combined.includes('attachment') || combined.includes('.pdf') || combined.includes('invoice.pdf')) {
    return 'optional';
  }
  return 'unknown';
}

function buildQuestions(params: {
  answers: FilterDraftAnswerMap;
  fieldsDetected: FilterDraftField[];
  attachmentRelevance: FilterDraftAnalysis['attachment_relevance'];
  parserFamilyGuess: FilterDraftAnalysis['parser_family_guess'];
  samples: NormalizedFilterDraftSample[];
}): FilterDraftQuestion[] {
  const questions: FilterDraftQuestion[] = [];
  const referenceOptions = params.fieldsDetected
    .filter((field) => field.field === 'reference_id')
    .map((field) => field.value)
    .slice(0, 4);
  if (referenceOptions.length > 1 && params.answers.reference_id === undefined) {
    questions.push({
      id: 'reference_id',
      question: 'Which value should be treated as the transaction/reference ID?',
      reason: 'Multiple reference-like values were detected across the samples.',
      answer_type: 'single_select',
      options: referenceOptions,
      required: true
    });
  }

  const dateOptions = params.fieldsDetected
    .filter((field) => field.field === 'date')
    .map((field) => field.value)
    .slice(0, 4);
  if (dateOptions.length > 1 && params.answers.event_date === undefined) {
    questions.push({
      id: 'event_date',
      question: 'Which date matters for the downstream event or deadline?',
      reason: 'More than one date candidate was found in the samples.',
      answer_type: 'single_select',
      options: dateOptions,
      required: false
    });
  }

  if (
    (params.parserFamilyGuess === 'unknown' || params.parserFamilyGuess === 'generic_ai') &&
    params.answers.event_disposition === undefined
  ) {
    questions.push({
      id: 'event_disposition',
      question: 'Should this email create an RVI, or is it informational only?',
      reason: 'The parser family could not be inferred with enough confidence.',
      answer_type: 'single_select',
      options: ['create_rvi', 'informational_only'],
      required: true
    });
  }

  if (params.attachmentRelevance === 'optional' && params.answers.attachment_required === undefined) {
    questions.push({
      id: 'attachment_required',
      question: 'Should a matching email require an attachment?',
      reason: 'The samples mention or include attachments, but they may not be mandatory.',
      answer_type: 'boolean',
      required: false
    });
  }

  const personLikeTokens = params.samples
    .flatMap((sample) => sample.normalized_body.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) ?? [])
    .filter((value) => value.length >= 5);
  const uniqueNames = Array.from(new Set(personLikeTokens)).slice(0, 4);
  if (
    questions.length < 3 &&
    uniqueNames.length > 1 &&
    params.answers.person_identifier === undefined
  ) {
    questions.push({
      id: 'person_identifier',
      question: 'Which part identifies the person or business for the final title?',
      reason: 'More than one name-like token was found in the email body.',
      answer_type: 'single_select',
      options: uniqueNames,
      required: false
    });
  }

  return questions.slice(0, 3);
}

function buildMonitorNameSuggestion(
  requestedName: string,
  titleSourceGuess: string | null,
  parserFamilyGuess: FilterDraftAnalysis['parser_family_guess']
): string {
  const explicit = normalizeString(requestedName);
  if (explicit) return explicit;
  if (titleSourceGuess && parserFamilyGuess && parserFamilyGuess !== 'unknown') {
    return `${titleSourceGuess} (${parserFamilyGuess})`;
  }
  if (titleSourceGuess) {
    return `${titleSourceGuess} email draft`;
  }
  return 'Email filter draft';
}

function buildGenericAiPrompt(analysis: FilterDraftAnalysis, answers: FilterDraftAnswerMap): string {
  const eventDisposition = normalizeString(answers.event_disposition) ?? 'create_rvi';
  const titleSource = normalizeString(answers.person_identifier) ?? analysis.title_source_guess ?? 'entity_name';
  const referenceId = normalizeString(answers.reference_id) ?? firstDetectedValue(analysis.fields_detected, 'reference_id');
  const eventDate = normalizeString(answers.event_date) ?? firstDetectedValue(analysis.fields_detected, 'date');

  return [
    'Return strict JSON only.',
    `Disposition: ${eventDisposition}.`,
    `Title source: ${titleSource}.`,
    referenceId ? `Primary reference field: ${referenceId}.` : 'Primary reference field is unknown; ask for review.',
    eventDate ? `Important date field: ${eventDate}.` : 'Important date field is unknown; ask for review.',
    `Stable anchors: ${analysis.stable_tokens.join(', ') || 'none'}.`,
    `Variable tokens to extract: ${analysis.variable_tokens.join(', ') || 'none'}.`
  ]
    .filter(Boolean)
    .join(' ');
}

function selectAllowedEventTypes(
  parserFamily: string | null,
  eventTypeGuess: string | null,
  eventDisposition: string | null
): string[] | null {
  if (eventDisposition === 'informational_only') {
    return null;
  }
  if (parserFamily === 'amazon') {
    return ['amazon.return_requested', 'amazon.return_dropped_off', 'amazon.refund_issued'];
  }
  if (parserFamily === 'manulife') {
    return [
      'manulife.claim_received',
      'manulife.claim_processed',
      'manulife.claim_paid',
      'manulife.claim_denied',
      'manulife.claim_info_required',
      'manulife.claim_status_update'
    ];
  }
  if (parserFamily === 'orthodontics') {
    return ['orthodontics.payment_approved'];
  }
  if (eventTypeGuess) {
    return [eventTypeGuess];
  }
  return null;
}

function buildAnchorRegex(values: string[], minAnchors: number): string | null {
  const normalized = values
    .map((value) => normalizeWhitespace(value))
    .filter((value) => value.length > 0);
  if (normalized.length === 0) return null;
  if (normalized.length === 1) {
    const anchors = informativeTokens(normalized[0]!).slice(0, minAnchors + 1);
    return anchors.length >= minAnchors
      ? anchors.map((token) => escapeRegex(token)).join('.*')
      : null;
  }

  const common = longestCommonAnchorSequence(normalized.map((value) => informativeTokens(value)));
  if (common.length < minAnchors) {
    return null;
  }
  return common.slice(0, 6).map((token) => escapeRegex(token)).join('.*');
}

function longestCommonAnchorSequence(tokenLists: string[][]): string[] {
  if (tokenLists.length === 0) return [];
  return tokenLists[0]!.filter((token, index, source) => {
    return (
      source.indexOf(token) === index &&
      tokenLists.every((tokens) => tokens.includes(token))
    );
  });
}

function extractReferenceIds(...values: string[]): string[] {
  const matches = new Set<string>();
  const patterns = [
    /\b[A-Z]{2,}-[A-Z0-9-]{4,}\b/g,
    /\b\d{3,}-\d{4,}-\d{4,}\b/g,
    /\b[A-Z0-9]{8,}\b/g
  ];
  for (const value of values) {
    for (const pattern of patterns) {
      for (const match of value.match(pattern) ?? []) {
        if (match.length >= 6) {
          matches.add(match);
        }
      }
    }
  }
  return Array.from(matches);
}

function extractAmounts(...values: string[]): string[] {
  const matches = new Set<string>();
  const pattern = /\b(?:CAD|USD|C\$|\$)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)\b/g;
  for (const value of values) {
    for (const match of value.matchAll(pattern)) {
      const amount = match[1]?.replace(/,/g, '');
      if (amount) {
        matches.add(amount);
      }
    }
  }
  return Array.from(matches);
}

function extractDates(...values: string[]): string[] {
  const matches = new Set<string>();
  const patterns = [
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,\s+\d{4})?\b/gi,
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g
  ];
  for (const value of values) {
    for (const pattern of patterns) {
      for (const match of value.match(pattern) ?? []) {
        matches.add(match);
      }
    }
  }
  return Array.from(matches);
}

function informativeTokens(value: string): string[] {
  return normalizeWhitespace(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !stopWords.has(token));
}

function normalizeBodyText(value: string): string {
  return normalizeWhitespace(normalizeHtmlToText(value));
}

function normalizeHtmlToText(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\s+\n/g, '\n').trim();
}

function firstDetectedValue(fields: FilterDraftField[], target: FilterDraftField['field']): string | null {
  return fields.find((field) => field.field === target)?.value ?? null;
}

function parseBooleanAnswer(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === 'no') return false;
  }
  return null;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return Number(value.toFixed(3));
}

const stopWords = new Set([
  'this',
  'that',
  'with',
  'from',
  'your',
  'have',
  'will',
  'been',
  'then',
  'after',
  'payment',
  'email',
  'received',
  'invoice',
  'claim',
  'return',
  'refund'
]);
