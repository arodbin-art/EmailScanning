import {
  FilterDraftAnalysis,
  FilterDraftAnswerMap,
  FilterDraftSessionInput,
  NormalizedFilterDraftSample,
  buildHeuristicDraftAnalysis,
  validateAiAnalysisPayload
} from './filterDraftAnalysis.js';

export type FilterDraftAnalysisResult = {
  analysis: FilterDraftAnalysis;
  provider: string;
  model: string | null;
};

export interface FilterDraftAnalysisProvider {
  analyze(params: {
    session: FilterDraftSessionInput;
    samples: NormalizedFilterDraftSample[];
    answers: FilterDraftAnswerMap;
  }): Promise<FilterDraftAnalysisResult>;
}

export class HeuristicFilterDraftAnalysisProvider implements FilterDraftAnalysisProvider {
  async analyze(params: {
    session: FilterDraftSessionInput;
    samples: NormalizedFilterDraftSample[];
    answers: FilterDraftAnswerMap;
  }): Promise<FilterDraftAnalysisResult> {
    return {
      analysis: buildHeuristicDraftAnalysis(params),
      provider: 'heuristic',
      model: null
    };
  }
}

export class AzureOpenAiFilterDraftAnalysisProvider implements FilterDraftAnalysisProvider {
  private readonly endpoint: string;
  private readonly deployment: string;
  private readonly apiKey: string;
  private readonly apiVersion: string;
  private readonly modelLabel: string;

  constructor(params: {
    endpoint: string;
    deployment: string;
    apiKey: string;
    apiVersion?: string;
    modelLabel?: string;
  }) {
    this.endpoint = params.endpoint.replace(/\/$/, '');
    this.deployment = params.deployment;
    this.apiKey = params.apiKey;
    this.apiVersion = params.apiVersion ?? '2024-10-21';
    this.modelLabel = params.modelLabel ?? params.deployment;
  }

  async analyze(params: {
    session: FilterDraftSessionInput;
    samples: NormalizedFilterDraftSample[];
    answers: FilterDraftAnswerMap;
  }): Promise<FilterDraftAnalysisResult> {
    const response = await fetch(
      `${this.endpoint}/openai/deployments/${this.deployment}/chat/completions?api-version=${encodeURIComponent(
        this.apiVersion
      )}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey
        },
        body: JSON.stringify({
          temperature: 0,
          messages: [
            {
              role: 'system',
              content:
                'You design deterministic email filters. Return strict JSON only. Ask at most 3 targeted clarification questions.'
            },
            {
              role: 'user',
              content: buildPrompt(params)
            }
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'filter_draft_analysis',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'monitor_name_suggestion',
                  'capture_key_suggestion',
                  'sender_rules',
                  'subject_regex',
                  'body_regex',
                  'parser_family_guess',
                  'event_type_guess',
                  'title_source_guess',
                  'description_source_guess',
                  'fields_detected',
                  'variable_tokens',
                  'stable_tokens',
                  'attachment_relevance',
                  'questions',
                  'confidence',
                  'notes'
                ],
                properties: {
                  monitor_name_suggestion: { type: 'string' },
                  capture_key_suggestion: { type: ['string', 'null'] },
                  sender_rules: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['type', 'value'],
                      properties: {
                        type: { type: 'string', enum: ['exact', 'domain', 'regex'] },
                        value: { type: 'string' }
                      }
                    }
                  },
                  subject_regex: { type: ['string', 'null'] },
                  body_regex: { type: ['string', 'null'] },
                  parser_family_guess: {
                    type: ['string', 'null'],
                    enum: ['amazon', 'manulife', 'orthodontics', 'generic_ai', 'unknown', null]
                  },
                  event_type_guess: { type: ['string', 'null'] },
                  title_source_guess: { type: ['string', 'null'] },
                  description_source_guess: { type: ['string', 'null'] },
                  fields_detected: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['field', 'value', 'source', 'confidence'],
                      properties: {
                        field: {
                          type: 'string',
                          enum: [
                            'sender',
                            'subject_anchor',
                            'body_anchor',
                            'reference_id',
                            'amount',
                            'date',
                            'title_candidate',
                            'description_candidate'
                          ]
                        },
                        value: { type: 'string' },
                        source: { type: 'string', enum: ['from_address', 'subject', 'body'] },
                        confidence: { type: 'number' }
                      }
                    }
                  },
                  variable_tokens: { type: 'array', items: { type: 'string' } },
                  stable_tokens: { type: 'array', items: { type: 'string' } },
                  attachment_relevance: {
                    type: 'string',
                    enum: ['required', 'optional', 'none', 'unknown']
                  },
                  questions: {
                    type: 'array',
                    maxItems: 3,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['id', 'question', 'reason', 'answer_type', 'required'],
                      properties: {
                        id: { type: 'string' },
                        question: { type: 'string' },
                        reason: { type: 'string' },
                        answer_type: { type: 'string', enum: ['text', 'single_select', 'boolean'] },
                        options: { type: 'array', items: { type: 'string' } },
                        required: { type: 'boolean' }
                      }
                    }
                  },
                  confidence: { type: 'number' },
                  notes: { type: 'array', items: { type: 'string' } }
                }
              }
            }
          }
        })
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Azure OpenAI request failed: ${response.status} ${text}`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('Azure OpenAI response missing content');
    }

    const parsed = JSON.parse(content);
    return {
      analysis: validateAiAnalysisPayload(parsed),
      provider: 'azure_openai',
      model: this.modelLabel
    };
  }
}

export async function analyzeFilterDraft(params: {
  session: FilterDraftSessionInput;
  samples: NormalizedFilterDraftSample[];
  answers: FilterDraftAnswerMap;
}): Promise<FilterDraftAnalysisResult> {
  const heuristicProvider = new HeuristicFilterDraftAnalysisProvider();
  const aiEnabled = (process.env.FILTER_DRAFT_AI_ENABLED ?? 'true').toLowerCase() !== 'false';
  if (!aiEnabled) {
    return heuristicProvider.analyze(params);
  }

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
  const deployment = process.env.AZURE_OPENAI_FILTER_DRAFT_DEPLOYMENT?.trim();
  const apiKey = process.env.AZURE_OPENAI_API_KEY?.trim();
  if (!endpoint || !deployment || !apiKey) {
    return heuristicProvider.analyze(params);
  }

  const provider = new AzureOpenAiFilterDraftAnalysisProvider({
    endpoint,
    deployment,
    apiKey,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION?.trim(),
    modelLabel: process.env.AZURE_OPENAI_FILTER_DRAFT_MODEL?.trim() || deployment
  });

  try {
    return await provider.analyze(params);
  } catch (error) {
    const fallback = await heuristicProvider.analyze(params);
    fallback.analysis.notes = [
      ...fallback.analysis.notes,
      `Azure OpenAI fallback triggered: ${error instanceof Error ? error.message : String(error)}`
    ];
    return fallback;
  }
}

function buildPrompt(params: {
  session: FilterDraftSessionInput;
  samples: NormalizedFilterDraftSample[];
  answers: FilterDraftAnswerMap;
}): string {
  return [
    'Design a proposed deterministic monitor/filter from sample emails.',
    'Rules:',
    '- The workflow is for onboarding a new sender/source, not for freeform chat.',
    '- Use stable text across both samples as anchors.',
    '- Treat changing values as extractable variables.',
    '- Ask 0 to 3 structured clarification questions only if needed.',
    '- Do not assume production save; this is a draft proposal for admin review.',
    '',
    `Requested draft name: ${params.session.name || '(none supplied)'}`,
    `Provider: ${params.session.provider}`,
    `Scope: ${params.session.scope}`,
    `Mail account ids: ${params.session.mail_account_ids.join(', ') || '(all)'}`,
    '',
    `Known answers: ${JSON.stringify(params.answers)}`,
    '',
    ...params.samples.map((sample) =>
      [
        `Sample ${sample.sample_index}:`,
        `From: ${sample.from_address}`,
        `Subject: ${sample.subject}`,
        `Body:`,
        sample.normalized_body
      ].join('\n')
    )
  ].join('\n');
}
