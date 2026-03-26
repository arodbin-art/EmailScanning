import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from './db.js';
import {
  FilterDraftProposalRecord,
  FilterDraftQuestionRecord,
  FilterDraftSampleRecord,
  FilterDraftSessionRecord,
  FilterDraftSessionStatus
} from './types.js';
import {
  FilterDraftAnalysis,
  FilterDraftProposal,
  FilterDraftQuestion,
  FilterDraftSessionInput,
  NormalizedFilterDraftSample
} from './filterDraftAnalysis.js';

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

export async function createFilterDraftSession(input: FilterDraftSessionInput): Promise<FilterDraftSessionRecord> {
  const id = cryptoRandomId('fd_session');
  const mailAccountIdsJson =
    input.scope === 'selected' ? JSON.stringify(Array.from(new Set(input.mail_account_ids))) : null;

  const rows = (await prisma.$queryRaw`
    INSERT INTO email_scanning.filter_draft_sessions (
      id,
      name,
      provider,
      scope,
      mail_account_ids,
      status,
      analysis_provider,
      analysis_model,
      latest_confidence,
      latest_summary_json,
      monitor_id,
      created_at,
      updated_at
    ) VALUES (
      ${id},
      ${input.name},
      ${input.provider},
      ${input.scope}::email_scanning.monitor_scope,
      ${mailAccountIdsJson}::jsonb,
      'draft'::email_scanning.filter_draft_session_status,
      'heuristic',
      NULL,
      NULL,
      NULL,
      NULL,
      NOW(),
      NOW()
    )
    RETURNING
      id,
      name,
      provider,
      scope,
      mail_account_ids,
      status::text as status,
      analysis_provider,
      analysis_model,
      latest_confidence,
      latest_summary_json,
      monitor_id,
      created_at,
      updated_at
  `) as Array<Omit<FilterDraftSessionRecord, 'samples' | 'questions' | 'latest_proposal'>>;

  return {
    ...mapSessionRow(rows[0]!),
    samples: [],
    questions: [],
    latest_proposal: null
  };
}

export async function replaceFilterDraftSamples(
  sessionId: string,
  samples: NormalizedFilterDraftSample[]
): Promise<FilterDraftSampleRecord[]> {
  return prisma.$transaction(async (tx) => {
    const sampleIndexes = samples.map((sample) => sample.sample_index);
    if (sampleIndexes.length > 0) {
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM email_scanning.filter_draft_samples
        WHERE session_id = ${sessionId}
          AND sample_index NOT IN (${Prisma.join(sampleIndexes)})
      `);
    }

    for (const sample of samples) {
      const id = `${sessionId}:sample:${sample.sample_index}`;
      await tx.$queryRaw`
        INSERT INTO email_scanning.filter_draft_samples (
          id,
          session_id,
          sample_index,
          source_kind,
          raw_source,
          filename,
          from_address,
          subject,
          body_text,
          body_html,
          normalized_body,
          parsed_email_json,
          created_at,
          updated_at
        ) VALUES (
          ${id},
          ${sessionId},
          ${sample.sample_index},
          ${sample.source_kind},
          ${sample.raw_source},
          ${sample.filename},
          ${sample.from_address},
          ${sample.subject},
          ${sample.body_text},
          ${sample.body_html},
          ${sample.normalized_body},
          ${JSON.stringify(sample.parsed_email_json)}::jsonb,
          NOW(),
          NOW()
        )
        ON CONFLICT (session_id, sample_index) DO UPDATE SET
          source_kind = EXCLUDED.source_kind,
          raw_source = EXCLUDED.raw_source,
          filename = EXCLUDED.filename,
          from_address = EXCLUDED.from_address,
          subject = EXCLUDED.subject,
          body_text = EXCLUDED.body_text,
          body_html = EXCLUDED.body_html,
          normalized_body = EXCLUDED.normalized_body,
          parsed_email_json = EXCLUDED.parsed_email_json,
          updated_at = NOW()
      `;
    }

    const rows = (await tx.$queryRaw`
      SELECT
        id,
        sample_index,
        source_kind,
        raw_source,
        filename,
        from_address,
        subject,
        body_text,
        body_html,
        normalized_body,
        parsed_email_json,
        created_at,
        updated_at
      FROM email_scanning.filter_draft_samples
      WHERE session_id = ${sessionId}
      ORDER BY sample_index ASC
    `) as FilterDraftSampleRecord[];

    await tx.$executeRaw`
      UPDATE email_scanning.filter_draft_sessions
      SET updated_at = NOW()
      WHERE id = ${sessionId}
    `;

    return rows.map(mapSampleRow);
  });
}

export async function upsertFilterDraftAnswers(
  sessionId: string,
  answers: Array<{ question_id: string; value: string | boolean }>
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const answer of answers) {
      const questionId = `${sessionId}:question:${answer.question_id}`;
      const id = `${sessionId}:answer:${answer.question_id}`;
      await tx.$queryRaw`
        INSERT INTO email_scanning.filter_draft_answers (
          id,
          session_id,
          question_id,
          answer_json,
          created_at,
          updated_at
        ) VALUES (
          ${id},
          ${sessionId},
          ${questionId},
          ${JSON.stringify({ value: answer.value })}::jsonb,
          NOW(),
          NOW()
        )
        ON CONFLICT (session_id, question_id) DO UPDATE SET
          answer_json = EXCLUDED.answer_json,
          updated_at = NOW()
      `;

      await tx.$executeRaw`
        UPDATE email_scanning.filter_draft_questions
        SET answered_at = NOW()
        WHERE id = ${questionId}
      `;
    }

    await tx.$executeRaw`
      UPDATE email_scanning.filter_draft_sessions
      SET updated_at = NOW()
      WHERE id = ${sessionId}
    `;
  });
}

export async function saveFilterDraftAnalysis(params: {
  sessionId: string;
  status: FilterDraftSessionStatus;
  provider: string;
  model: string | null;
  analysis: FilterDraftAnalysis;
  proposal: FilterDraftProposal;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const questionIds = params.analysis.questions.map((question) => `${params.sessionId}:question:${question.id}`);

    if (questionIds.length > 0) {
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM email_scanning.filter_draft_answers
        WHERE session_id = ${params.sessionId}
          AND question_id NOT IN (${Prisma.join(questionIds)})
      `);
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM email_scanning.filter_draft_questions
        WHERE session_id = ${params.sessionId}
          AND id NOT IN (${Prisma.join(questionIds)})
      `);
    } else {
      await tx.$executeRaw`
        DELETE FROM email_scanning.filter_draft_answers
        WHERE session_id = ${params.sessionId}
      `;
      await tx.$executeRaw`
        DELETE FROM email_scanning.filter_draft_questions
        WHERE session_id = ${params.sessionId}
      `;
    }

    for (const question of params.analysis.questions) {
      const id = `${params.sessionId}:question:${question.id}`;
      await tx.$queryRaw`
        INSERT INTO email_scanning.filter_draft_questions (
          id,
          session_id,
          question_key,
          question_json,
          created_at,
          answered_at
        ) VALUES (
          ${id},
          ${params.sessionId},
          ${question.id},
          ${JSON.stringify(question)}::jsonb,
          NOW(),
          NULL
        )
        ON CONFLICT (session_id, question_key) DO UPDATE SET
          question_json = EXCLUDED.question_json
      `;
    }

    const proposalId = cryptoRandomId(`${params.sessionId}:proposal`);
    await tx.$queryRaw`
      INSERT INTO email_scanning.filter_draft_proposals (
        id,
        session_id,
        proposal_json,
        analysis_json,
        confidence,
        created_monitor_id,
        created_at
      ) VALUES (
        ${proposalId},
        ${params.sessionId},
        ${JSON.stringify(params.proposal)}::jsonb,
        ${JSON.stringify(params.analysis)}::jsonb,
        ${params.analysis.confidence},
        NULL,
        NOW()
      )
    `;

    await tx.$executeRaw`
      UPDATE email_scanning.filter_draft_sessions
      SET
        status = ${params.status}::email_scanning.filter_draft_session_status,
        analysis_provider = ${params.provider},
        analysis_model = ${params.model},
        latest_confidence = ${params.analysis.confidence},
        latest_summary_json = ${JSON.stringify(params.analysis)}::jsonb,
        updated_at = NOW()
      WHERE id = ${params.sessionId}
    `;

    await tx.$executeRaw`
      UPDATE email_scanning.filter_draft_questions q
      SET answered_at = a.updated_at
      FROM email_scanning.filter_draft_answers a
      WHERE q.session_id = ${params.sessionId}
        AND a.session_id = ${params.sessionId}
        AND a.question_id = q.id
    `;
  });
}

export async function markFilterDraftMonitorCreated(params: {
  sessionId: string;
  monitorId: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE email_scanning.filter_draft_sessions
      SET
        status = 'monitor_created'::email_scanning.filter_draft_session_status,
        monitor_id = ${params.monitorId},
        updated_at = NOW()
      WHERE id = ${params.sessionId}
    `;

    await tx.$executeRaw(Prisma.sql`
      UPDATE email_scanning.filter_draft_proposals
      SET created_monitor_id = ${params.monitorId}
      WHERE id = (
        SELECT id
        FROM email_scanning.filter_draft_proposals
        WHERE session_id = ${params.sessionId}
        ORDER BY created_at DESC
        LIMIT 1
      )
    `);
  });
}

export async function getFilterDraftSession(sessionId: string): Promise<FilterDraftSessionRecord | null> {
  const sessionRows = (await prisma.$queryRaw`
    SELECT
      id,
      name,
      provider,
      scope,
      mail_account_ids,
      status::text as status,
      analysis_provider,
      analysis_model,
      latest_confidence,
      latest_summary_json,
      monitor_id,
      created_at,
      updated_at
    FROM email_scanning.filter_draft_sessions
    WHERE id = ${sessionId}
  `) as Array<Omit<FilterDraftSessionRecord, 'samples' | 'questions' | 'latest_proposal'>>;
  const session = sessionRows[0];
  if (!session) {
    return null;
  }

  const sampleRows = (await prisma.$queryRaw`
    SELECT
      id,
      sample_index,
      source_kind,
      raw_source,
      filename,
      from_address,
      subject,
      body_text,
      body_html,
      normalized_body,
      parsed_email_json,
      created_at,
      updated_at
    FROM email_scanning.filter_draft_samples
    WHERE session_id = ${sessionId}
    ORDER BY sample_index ASC
  `) as FilterDraftSampleRecord[];

  const questionRows = (await prisma.$queryRaw`
    SELECT
      q.id,
      q.question_key,
      q.question_json,
      q.created_at,
      q.answered_at,
      a.answer_json
    FROM email_scanning.filter_draft_questions q
    LEFT JOIN email_scanning.filter_draft_answers a
      ON a.session_id = q.session_id
     AND a.question_id = q.id
    WHERE q.session_id = ${sessionId}
    ORDER BY q.created_at ASC
  `) as FilterDraftQuestionRecord[];

  const proposalRows = (await prisma.$queryRaw`
    SELECT
      id,
      proposal_json,
      analysis_json,
      confidence,
      created_monitor_id,
      created_at
    FROM email_scanning.filter_draft_proposals
    WHERE session_id = ${sessionId}
    ORDER BY created_at DESC
    LIMIT 1
  `) as FilterDraftProposalRecord[];

  return {
    ...mapSessionRow(session),
    samples: sampleRows.map(mapSampleRow),
    questions: questionRows.map(mapQuestionRow),
    latest_proposal: proposalRows[0] ? mapProposalRow(proposalRows[0]) : null
  };
}

function cryptoRandomId(prefix: string): string {
  return `${prefix}:${randomUUID()}`;
}

function mapSessionRow(
  row: Omit<FilterDraftSessionRecord, 'samples' | 'questions' | 'latest_proposal'>
): Omit<FilterDraftSessionRecord, 'samples' | 'questions' | 'latest_proposal'> {
  return {
    ...row,
    mail_account_ids: normalizeJson<number[]>(row.mail_account_ids),
    latest_confidence: toNumber(row.latest_confidence),
    latest_summary_json: normalizeJson(row.latest_summary_json)
  };
}

function mapSampleRow(row: FilterDraftSampleRecord): FilterDraftSampleRecord {
  return {
    ...row,
    parsed_email_json: normalizeJson(row.parsed_email_json)
  };
}

function mapQuestionRow(row: FilterDraftQuestionRecord): FilterDraftQuestionRecord {
  return {
    ...row,
    question_json: normalizeJson(row.question_json),
    answer_json: normalizeJson(row.answer_json)
  };
}

function mapProposalRow(row: FilterDraftProposalRecord): FilterDraftProposalRecord {
  return {
    ...row,
    proposal_json: normalizeJson(row.proposal_json),
    analysis_json: normalizeJson(row.analysis_json),
    confidence: toNumber(row.confidence)
  };
}
