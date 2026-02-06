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
    'enabled',
    'created_at'
  ],
  monitors: [
    'id',
    'name',
    'enabled',
    'provider',
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
  ]
};

export async function validateSchemaOrThrow(): Promise<void> {
  const rows = (await prisma.$queryRaw`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'email_scanning'
      AND table_name IN ('mail_accounts', 'monitors')
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
