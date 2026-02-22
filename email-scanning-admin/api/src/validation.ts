import { z } from 'zod';
import { ValidationWarning } from './types.js';

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
