import { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { EventRecord, EventsOutboxStatus, MailAccountRecord, MonitorRecord } from './types.js';

function normalizeJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'object') {
    const decimal = value as { toNumber?: () => number };
    if (typeof decimal.toNumber === 'function') {
      return decimal.toNumber();
    }
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseJson(value: unknown): unknown | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

export async function listMailAccounts(): Promise<MailAccountRecord[]> {
  return (await prisma.$queryRaw`
    SELECT
      id,
      provider,
      account_label,
      mailbox_address,
      auth_type,
      moneyrecovery_person_code,
      enabled,
      created_at
    FROM email_scanning.mail_accounts
    ORDER BY id ASC
  `) as MailAccountRecord[];
}

export async function createMailAccount(input: {
  provider: string;
  account_label: string;
  mailbox_address: string;
  auth_type: string;
  moneyrecovery_person_code: string | null;
  enabled: boolean;
  encrypted_credentials_ref: string;
}): Promise<MailAccountRecord> {
  const rows = (await prisma.$queryRaw`
    INSERT INTO email_scanning.mail_accounts (
      provider,
      account_label,
      mailbox_address,
      auth_type,
      encrypted_credentials_ref,
      moneyrecovery_person_code,
      enabled,
      created_at
    ) VALUES (
      ${input.provider},
      ${input.account_label},
      ${input.mailbox_address},
      ${input.auth_type},
      ${input.encrypted_credentials_ref},
      ${input.moneyrecovery_person_code},
      ${input.enabled},
      NOW()
    )
    RETURNING
      id,
      provider,
      account_label,
      mailbox_address,
      auth_type,
      moneyrecovery_person_code,
      enabled,
      created_at
  `) as MailAccountRecord[];
  return rows[0]!;
}

export async function updateMailAccount(
  id: number,
  input: {
    provider: string;
    account_label: string;
    mailbox_address: string;
    auth_type: string;
    moneyrecovery_person_code: string | null;
    enabled: boolean;
  }
): Promise<MailAccountRecord | null> {
  const rows = (await prisma.$queryRaw`
    UPDATE email_scanning.mail_accounts
    SET
      provider = ${input.provider},
      account_label = ${input.account_label},
      mailbox_address = ${input.mailbox_address},
      auth_type = ${input.auth_type},
      moneyrecovery_person_code = ${input.moneyrecovery_person_code},
      enabled = ${input.enabled}
    WHERE id = ${id}
    RETURNING
      id,
      provider,
      account_label,
      mailbox_address,
      auth_type,
      moneyrecovery_person_code,
      enabled,
      created_at
  `) as MailAccountRecord[];
  return rows[0] ?? null;
}

export async function deleteMailAccount(id: number): Promise<number> {
  const result = await prisma.$executeRaw`
    DELETE FROM email_scanning.mail_accounts WHERE id = ${id}
  `;
  return result;
}

export async function listMonitors(): Promise<MonitorRecord[]> {
  const rows = (await prisma.$queryRaw`
    SELECT
      id,
      name,
      enabled,
      provider,
      scope,
      mail_account_ids,
      sender_rules,
      from_contains,
      subject_contains,
      subject_regex,
      body_regex,
      has_attachments,
      gmail_label,
      ai_prompt_template,
      confidence_threshold,
      allowed_event_types,
      created_at,
      updated_at
    FROM email_scanning.monitors
    ORDER BY updated_at DESC
  `) as MonitorRecord[];
  return rows.map((row) => ({
    ...row,
    mail_account_ids: normalizeJson<number[]>(row.mail_account_ids),
    sender_rules: normalizeJson(row.sender_rules),
    allowed_event_types: normalizeJson<string[]>(row.allowed_event_types),
    confidence_threshold: toNumber(row.confidence_threshold)
  }));
}

export async function createMonitor(input: {
  id: string;
  name: string;
  enabled: boolean;
  provider: string;
  scope: 'all' | 'selected';
  mail_account_ids: number[] | null;
  sender_rules: unknown | null;
  from_contains: string | null;
  subject_contains: string | null;
  subject_regex: string | null;
  body_regex: string | null;
  has_attachments: boolean | null;
  gmail_label: string | null;
  ai_prompt_template: string | null;
  confidence_threshold: number | null;
  allowed_event_types: string[] | null;
}): Promise<MonitorRecord> {
  const senderRulesJson = input.sender_rules === null ? null : JSON.stringify(input.sender_rules);
  const mailAccountIdsJson = input.mail_account_ids === null ? null : JSON.stringify(input.mail_account_ids);
  const allowedEventTypesJson =
    input.allowed_event_types === null ? null : JSON.stringify(input.allowed_event_types);

  const rows = (await prisma.$queryRaw`
    INSERT INTO email_scanning.monitors (
      id,
      name,
      enabled,
      provider,
      sender_rules,
      from_contains,
      subject_contains,
      subject_regex,
      body_regex,
      has_attachments,
      gmail_label,
      scope,
      mail_account_ids,
      ai_prompt_template,
      confidence_threshold,
      allowed_event_types,
      created_at,
      updated_at
    ) VALUES (
      ${input.id},
      ${input.name},
      ${input.enabled},
      ${input.provider},
      ${senderRulesJson}::jsonb,
      ${input.from_contains},
      ${input.subject_contains},
      ${input.subject_regex},
      ${input.body_regex},
      ${input.has_attachments},
      ${input.gmail_label},
      ${input.scope},
      ${mailAccountIdsJson}::jsonb,
      ${input.ai_prompt_template},
      ${input.confidence_threshold},
      ${allowedEventTypesJson}::jsonb,
      NOW(),
      NOW()
    )
    RETURNING
      id,
      name,
      enabled,
      provider,
      scope,
      mail_account_ids,
      sender_rules,
      from_contains,
      subject_contains,
      subject_regex,
      body_regex,
      has_attachments,
      gmail_label,
      ai_prompt_template,
      confidence_threshold,
      allowed_event_types,
      created_at,
      updated_at
  `) as MonitorRecord[];

  const row = rows[0]!;
  return {
    ...row,
    mail_account_ids: normalizeJson<number[]>(row.mail_account_ids),
    sender_rules: normalizeJson(row.sender_rules),
    allowed_event_types: normalizeJson<string[]>(row.allowed_event_types),
    confidence_threshold: toNumber(row.confidence_threshold)
  };
}

export async function updateMonitor(
  id: string,
  input: {
    name: string;
    enabled: boolean;
    provider: string;
    scope: 'all' | 'selected';
    mail_account_ids: number[] | null;
    sender_rules: unknown | null;
    from_contains: string | null;
    subject_contains: string | null;
    subject_regex: string | null;
    body_regex: string | null;
    has_attachments: boolean | null;
    gmail_label: string | null;
    ai_prompt_template: string | null;
    confidence_threshold: number | null;
    allowed_event_types: string[] | null;
  }
): Promise<MonitorRecord | null> {
  const senderRulesJson = input.sender_rules === null ? null : JSON.stringify(input.sender_rules);
  const mailAccountIdsJson = input.mail_account_ids === null ? null : JSON.stringify(input.mail_account_ids);
  const allowedEventTypesJson =
    input.allowed_event_types === null ? null : JSON.stringify(input.allowed_event_types);

  const rows = (await prisma.$queryRaw`
    UPDATE email_scanning.monitors
    SET
      name = ${input.name},
      enabled = ${input.enabled},
      provider = ${input.provider},
      sender_rules = ${senderRulesJson}::jsonb,
      from_contains = ${input.from_contains},
      subject_contains = ${input.subject_contains},
      subject_regex = ${input.subject_regex},
      body_regex = ${input.body_regex},
      has_attachments = ${input.has_attachments},
      gmail_label = ${input.gmail_label},
      scope = ${input.scope},
      mail_account_ids = ${mailAccountIdsJson}::jsonb,
      ai_prompt_template = ${input.ai_prompt_template},
      confidence_threshold = ${input.confidence_threshold},
      allowed_event_types = ${allowedEventTypesJson}::jsonb,
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING
      id,
      name,
      enabled,
      provider,
      scope,
      mail_account_ids,
      sender_rules,
      from_contains,
      subject_contains,
      subject_regex,
      body_regex,
      has_attachments,
      gmail_label,
      ai_prompt_template,
      confidence_threshold,
      allowed_event_types,
      created_at,
      updated_at
  `) as MonitorRecord[];
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    ...row,
    mail_account_ids: normalizeJson<number[]>(row.mail_account_ids),
    sender_rules: normalizeJson(row.sender_rules),
    allowed_event_types: normalizeJson<string[]>(row.allowed_event_types),
    confidence_threshold: toNumber(row.confidence_threshold)
  };
}

export async function deleteMonitor(id: string): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM email_scanning.monitors WHERE id = ${id}
  `;
}

export async function getMailAccountProviders(ids: number[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = (await prisma.$queryRaw`
    SELECT provider
    FROM email_scanning.mail_accounts
    WHERE id = ANY(${ids}::int[])
  `) as { provider: string }[];
  return rows.map((row) => row.provider);
}

export async function listEvents(input: {
  status?: EventsOutboxStatus;
  limit?: number;
}): Promise<EventRecord[]> {
  const whereClause = input.status
    ? Prisma.sql`WHERE eo.status = ${input.status}::email_scanning.events_outbox_status`
    : Prisma.empty;
  const limit = Math.max(1, Math.min(input.limit ?? 200, 1000));

  const rows = (await prisma.$queryRaw(Prisma.sql`
    SELECT
      eo.id,
      eo.status::text as status,
      eo.event_type,
      eo.created_at,
      eo.confidence,
      eo.source_email_id,
      eo.payload_json,
      er.subject as email_subject,
      er.from_address as email_from,
      er.received_at as email_received_at,
      edl.delivered_at,
      edl.rvi_response
    FROM email_scanning.events_outbox eo
    JOIN email_scanning.emails_raw er
      ON er.id = eo.source_email_id
    LEFT JOIN LATERAL (
      SELECT delivered_at, rvi_response
      FROM email_scanning.events_delivery_log
      WHERE event_id = eo.id
      ORDER BY delivered_at DESC
      LIMIT 1
    ) edl ON true
    ${whereClause}
    ORDER BY eo.created_at DESC
    LIMIT ${limit}
  `)) as EventRecord[];

  return rows.map((row) => ({
    ...row,
    status: row.status as EventsOutboxStatus,
    confidence: toNumber(row.confidence),
    payload_json: parseJson(row.payload_json),
    rvi_response: parseJson(row.rvi_response)
  }));
}
