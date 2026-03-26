import { z } from 'zod';
import { ValidationWarning } from './types.js';
import { filterDraftProposalSchema } from './filterDraftAnalysis.js';

export const mailAccountInputSchema = z.object({
  provider: z.string().min(1),
  account_label: z.string().min(1).max(100),
  mailbox_address: z.string().min(3).max(320),
  auth_type: z.string().min(1).max(50),
  moneyrecovery_person_code: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/)
    .optional()
    .nullable(),
  enabled: z.boolean().optional(),
  encrypted_credentials_ref: z.string().min(1).optional()
});

export const monitorInputSchema = z.object({
  name: z.string().min(1).max(200),
  enabled: z.boolean().optional(),
  provider: z.string().min(1).max(50),
  capture_key: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]+$/)
    .max(120)
    .optional()
    .nullable(),
  scope: z.enum(['all', 'selected']),
  mail_account_ids: z.array(z.number().int().positive()).optional(),
  sender_rules: z.unknown().optional(),
  from_contains: z.string().min(1).optional().nullable(),
  subject_contains: z.string().min(1).optional().nullable(),
  subject_regex: z.string().min(1).optional().nullable(),
  body_regex: z.string().min(1).optional().nullable(),
  has_attachments: z.boolean().optional().nullable(),
  gmail_label: z.string().min(1).optional().nullable(),
  ai_prompt_template: z.string().min(1).optional().nullable(),
  confidence_threshold: z.number().min(0).max(1).optional().nullable(),
  allowed_event_types: z.array(z.string().min(1)).optional().nullable()
});

export const filterDraftSessionInputSchema = z.object({
  name: z.string().min(1).max(200),
  provider: z.string().min(1).max(50),
  scope: z.enum(['all', 'selected']),
  mail_account_ids: z.array(z.number().int().positive()).default([])
});

export const filterDraftSampleInputSchema = z
  .object({
    sample_index: z.number().int().min(1).max(2),
    source_kind: z.enum(['structured', 'raw_email', 'eml']),
    raw_email: z.string().min(1).max(250000).optional().nullable(),
    raw_source: z.string().min(1).max(250000).optional().nullable(),
    filename: z.string().max(260).optional().nullable(),
    from: z.string().max(320).optional().nullable(),
    subject: z.string().max(998).optional().nullable(),
    body_text: z.string().max(250000).optional().nullable(),
    body_html: z.string().max(250000).optional().nullable()
  })
  .superRefine((value, ctx) => {
    if (value.source_kind === 'structured') {
      if (!value.from || !value.subject || (!value.body_text && !value.body_html)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Structured samples require from, subject, and body_text or body_html.'
        });
      }
      return;
    }
    if (!value.raw_email && !value.raw_source) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Raw email and .eml samples require raw_email or raw_source text.'
      });
    }
  });

export const filterDraftSamplesPayloadSchema = z.object({
  samples: z.array(filterDraftSampleInputSchema).min(1).max(2)
});

export const filterDraftAnswersPayloadSchema = z.object({
  answers: z
    .array(
      z.object({
        question_id: z.string().min(1),
        value: z.union([z.string(), z.boolean()])
      })
    )
    .min(1)
});

export const filterDraftCreateMonitorSchema = z.object({
  proposal: filterDraftProposalSchema.optional(),
  enabled: z.boolean().optional()
});

export function validateRegexOrThrow(value: string | null | undefined, label: string) {
  if (!value) return;
  try {
    new RegExp(value);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid regex';
    throw new Error(`${label} regex invalid: ${message}`);
  }
}

export function buildAiWarnings(
  aiPromptTemplate: string | null | undefined,
  aiEnabled: boolean
): ValidationWarning[] {
  if (aiPromptTemplate && !aiEnabled) {
    return [
      {
        code: 'AI_DISABLED',
        message: 'AI prompt template is set but AI is disabled globally.'
      }
    ];
  }
  return [];
}
