import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

const REQUIRED_COLUMNS: Record<string, string[]> = {
  mail_accounts: [
    'id',
    'provider',
    'account_label',
    'mailbox_address',
    'auth_type',
    'encrypted_credentials_ref',
    'moneyrecovery_person_code',
    'enabled',
    'created_at'
  ],
  monitors: [
    'id',
    'name',
    'enabled',
    'provider',
    'capture_key',
    'sender_rules',
    'from_contains',
    'subject_contains',
    'subject_regex',
    'body_regex',
    'has_attachments',
    'gmail_label',
    'scope',
    'mail_account_ids',
    'ai_prompt_template',
    'confidence_threshold',
    'allowed_event_types',
    'created_at',
    'updated_at'
  ],
  filter_draft_sessions: [
    'id',
    'name',
    'provider',
    'scope',
    'mail_account_ids',
    'status',
    'analysis_provider',
    'analysis_model',
    'latest_confidence',
    'latest_summary_json',
    'monitor_id',
    'created_at',
    'updated_at'
  ],
  filter_draft_samples: [
    'id',
    'session_id',
    'sample_index',
    'source_kind',
    'raw_source',
    'filename',
    'from_address',
    'subject',
    'body_text',
    'body_html',
    'normalized_body',
    'parsed_email_json',
    'created_at',
    'updated_at'
  ],
  filter_draft_questions: [
    'id',
    'session_id',
    'question_key',
    'question_json',
    'created_at',
    'answered_at'
  ],
  filter_draft_answers: [
    'id',
    'session_id',
    'question_id',
    'answer_json',
    'created_at',
    'updated_at'
  ],
  filter_draft_proposals: [
    'id',
    'session_id',
    'proposal_json',
    'analysis_json',
    'confidence',
    'created_monitor_id',
    'created_at'
  ]
};

export async function validateSchemaOrThrow(): Promise<void> {
  const rows = (await prisma.$queryRaw`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'email_scanning'
      AND table_name IN (
        'mail_accounts',
        'monitors',
        'filter_draft_sessions',
        'filter_draft_samples',
        'filter_draft_questions',
        'filter_draft_answers',
        'filter_draft_proposals'
      )
  `) as { table_name: string; column_name: string }[];

  const byTable = rows.reduce<Record<string, Set<string>>>((acc, row) => {
    if (!acc[row.table_name]) {
      acc[row.table_name] = new Set();
    }
    acc[row.table_name].add(row.column_name);
    return acc;
  }, {});

  const missing: string[] = [];
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const existing = byTable[table];
    if (!existing) {
      missing.push(`${table} (table missing)`);
      continue;
    }
    for (const column of columns) {
      if (!existing.has(column)) {
        missing.push(`${table}.${column}`);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Schema mismatch. Missing required columns: ${missing.join(', ')}`
    );
  }
}
