import express from 'express';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { requireAdmin } from './auth.js';
import {
  mailAccountInputSchema,
  monitorInputSchema,
  filterDraftSessionInputSchema,
  filterDraftSamplesPayloadSchema,
  filterDraftAnswersPayloadSchema,
  filterDraftCreateMonitorSchema,
  validateRegexOrThrow,
  buildAiWarnings
} from './validation.js';
import {
  listMailAccounts,
  createMailAccount,
  updateMailAccount,
  deleteMailAccount,
  listMonitors,
  createMonitor,
  updateMonitor,
  deleteMonitor,
  getMailAccountProviders,
  listEvents
} from './store.js';
import { EventsOutboxStatus } from './types.js';
import { getTemplateById, listTemplateSummaries } from './templates.js';
import {
  buildFilterDraftProposal,
  filterDraftProposalSchema,
  normalizeFilterDraftSample
} from './filterDraftAnalysis.js';
import { analyzeFilterDraft } from './filterDraftAi.js';
import {
  createFilterDraftSession,
  getFilterDraftSession,
  markFilterDraftMonitorCreated,
  replaceFilterDraftSamples,
  saveFilterDraftAnalysis,
  upsertFilterDraftAnswers
} from './filterDraftStore.js';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const uiDistPath = process.env.UI_DIST_PATH || path.join(process.cwd(), 'ui-dist');
  const uiIndexPath = path.join(uiDistPath, 'index.html');
  const hasUi = fs.existsSync(uiIndexPath);

  const allowedOrigins = new Set(
    (process.env.ADMIN_ALLOWED_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  );

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.size > 0) {
      if (allowedOrigins.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use('/api', requireAdmin);

  const aiEnabled = process.env.AI_ENABLED !== 'false';

  if (hasUi) {
    app.use(express.static(uiDistPath));
  }

  app.get('/api/mail-accounts', async (_req, res, next) => {
    try {
      const data = await listMailAccounts();
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/mail-accounts', async (req, res, next) => {
    try {
      const parsed = mailAccountInputSchema.parse(req.body);
      const encryptedRef = parsed.encrypted_credentials_ref ?? 'unset';
      const data = await createMailAccount({
        provider: parsed.provider,
        account_label: parsed.account_label,
        mailbox_address: parsed.mailbox_address,
        auth_type: parsed.auth_type,
        moneyrecovery_person_code: parsed.moneyrecovery_person_code ?? null,
        enabled: parsed.enabled ?? true,
        encrypted_credentials_ref: encryptedRef
      });
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  });

  app.put('/api/mail-accounts/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        res.status(400).json({ error: 'Invalid id' });
        return;
      }
      const parsed = mailAccountInputSchema.parse(req.body);
      const data = await updateMailAccount(id, {
        provider: parsed.provider,
        account_label: parsed.account_label,
        mailbox_address: parsed.mailbox_address,
        auth_type: parsed.auth_type,
        moneyrecovery_person_code: parsed.moneyrecovery_person_code ?? null,
        enabled: parsed.enabled ?? true
      });
      if (!data) {
        res.status(404).json({ error: 'Mail account not found' });
        return;
      }
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/mail-accounts/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        res.status(400).json({ error: 'Invalid id' });
        return;
      }
      await deleteMailAccount(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/monitors', async (_req, res, next) => {
    try {
      const data = await listMonitors();
      const warnings = data.flatMap((monitor) => buildAiWarnings(monitor.ai_prompt_template, aiEnabled));
      res.json({ data, warnings });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/templates', async (_req, res, _next) => {
    try {
      const data = listTemplateSummaries();
      res.json({ data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown template registry error';
      res.status(500).json({ error: `Template registry unavailable: ${message}` });
    }
  });

  app.get('/api/templates/:id', async (req, res, _next) => {
    try {
      const data = getTemplateById(req.params.id);
      if (!data) {
        res.status(404).json({ error: 'Template not found' });
        return;
      }
      res.json({ data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown template registry error';
      res.status(500).json({ error: `Template registry unavailable: ${message}` });
    }
  });

  app.post('/api/monitors', async (req, res, next) => {
    try {
      const parsed = monitorInputSchema.parse(req.body);
      validateRegexOrThrow(parsed.subject_regex, 'Subject');
      validateRegexOrThrow(parsed.body_regex, 'Body');

      if (parsed.scope === 'selected' && (!parsed.mail_account_ids || parsed.mail_account_ids.length === 0)) {
        res.status(400).json({ error: 'scope=selected requires mail_account_ids' });
        return;
      }

      const mailAccountIds = parsed.mail_account_ids ?? [];
      if (mailAccountIds.length > 0) {
        const providers = await getMailAccountProviders(mailAccountIds);
        const mismatch = providers.some((provider) => provider !== parsed.provider);
        if (mismatch || providers.length !== mailAccountIds.length) {
          res.status(400).json({ error: 'provider must match linked mail accounts' });
          return;
        }
      }

      const id = `mon_${randomUUID()}`;
      const data = await createMonitor({
        id,
        name: parsed.name,
        enabled: parsed.enabled ?? true,
        provider: parsed.provider,
        capture_key: parsed.capture_key ?? null,
        scope: parsed.scope,
        mail_account_ids: parsed.mail_account_ids ?? null,
        sender_rules: parsed.sender_rules ?? null,
        from_contains: parsed.from_contains ?? null,
        subject_contains: parsed.subject_contains ?? null,
        subject_regex: parsed.subject_regex ?? null,
        body_regex: parsed.body_regex ?? null,
        has_attachments: parsed.has_attachments ?? null,
        gmail_label: parsed.gmail_label ?? null,
        ai_prompt_template: parsed.ai_prompt_template ?? null,
        confidence_threshold: parsed.confidence_threshold ?? null,
        allowed_event_types: parsed.allowed_event_types ?? null
      });

      const warnings = buildAiWarnings(data.ai_prompt_template, aiEnabled);
      res.status(201).json({ data, warnings });
    } catch (err) {
      next(err);
    }
  });

  app.put('/api/monitors/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      const parsed = monitorInputSchema.parse(req.body);
      validateRegexOrThrow(parsed.subject_regex, 'Subject');
      validateRegexOrThrow(parsed.body_regex, 'Body');

      if (parsed.scope === 'selected' && (!parsed.mail_account_ids || parsed.mail_account_ids.length === 0)) {
        res.status(400).json({ error: 'scope=selected requires mail_account_ids' });
        return;
      }

      const mailAccountIds = parsed.mail_account_ids ?? [];
      if (mailAccountIds.length > 0) {
        const providers = await getMailAccountProviders(mailAccountIds);
        const mismatch = providers.some((provider) => provider !== parsed.provider);
        if (mismatch || providers.length !== mailAccountIds.length) {
          res.status(400).json({ error: 'provider must match linked mail accounts' });
          return;
        }
      }

      const data = await updateMonitor(id, {
        name: parsed.name,
        enabled: parsed.enabled ?? true,
        provider: parsed.provider,
        capture_key: parsed.capture_key ?? null,
        scope: parsed.scope,
        mail_account_ids: parsed.mail_account_ids ?? null,
        sender_rules: parsed.sender_rules ?? null,
        from_contains: parsed.from_contains ?? null,
        subject_contains: parsed.subject_contains ?? null,
        subject_regex: parsed.subject_regex ?? null,
        body_regex: parsed.body_regex ?? null,
        has_attachments: parsed.has_attachments ?? null,
        gmail_label: parsed.gmail_label ?? null,
        ai_prompt_template: parsed.ai_prompt_template ?? null,
        confidence_threshold: parsed.confidence_threshold ?? null,
        allowed_event_types: parsed.allowed_event_types ?? null
      });
      if (!data) {
        res.status(404).json({ error: 'Monitor not found' });
        return;
      }
      const warnings = buildAiWarnings(data.ai_prompt_template, aiEnabled);
      res.json({ data, warnings });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/filter-drafts', async (req, res, next) => {
    try {
      const parsed = filterDraftSessionInputSchema.parse(req.body);
      if (parsed.scope === 'selected' && parsed.mail_account_ids.length === 0) {
        res.status(400).json({ error: 'scope=selected requires mail_account_ids' });
        return;
      }
      if (parsed.mail_account_ids.length > 0) {
        const providers = await getMailAccountProviders(parsed.mail_account_ids);
        const mismatch = providers.some((provider) => provider !== parsed.provider);
        if (mismatch || providers.length !== parsed.mail_account_ids.length) {
          res.status(400).json({ error: 'provider must match linked mail accounts' });
          return;
        }
      }

      const data = await createFilterDraftSession(parsed);
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/filter-drafts/:id/samples', async (req, res, next) => {
    try {
      const session = await getFilterDraftSession(req.params.id);
      if (!session) {
        res.status(404).json({ error: 'Filter draft session not found' });
        return;
      }
      const parsed = filterDraftSamplesPayloadSchema.parse(req.body);
      const data = await replaceFilterDraftSamples(
        session.id,
        parsed.samples.map((sample) => normalizeFilterDraftSample(sample))
      );
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/filter-drafts/:id/analyze', async (req, res, next) => {
    try {
      const session = await getFilterDraftSession(req.params.id);
      if (!session) {
        res.status(404).json({ error: 'Filter draft session not found' });
        return;
      }
      if (session.samples.length === 0) {
        res.status(400).json({ error: 'Add at least one sample before analysis.' });
        return;
      }

      const answers = toFilterDraftAnswerMap(session);
      const analysisResult = await analyzeFilterDraft({
        session: {
          name: session.name,
          provider: session.provider,
          scope: session.scope,
          mail_account_ids: session.mail_account_ids ?? []
        },
        samples: session.samples.map((sample) => ({
          sample_index: sample.sample_index,
          source_kind: sample.source_kind as 'structured' | 'raw_email' | 'eml',
          raw_source: sample.raw_source,
          filename: sample.filename,
          from_address: sample.from_address ?? '',
          subject: sample.subject ?? '',
          body_text: sample.body_text ?? '',
          body_html: sample.body_html,
          normalized_body: sample.normalized_body,
          parsed_email_json: (sample.parsed_email_json as Record<string, unknown> | null) ?? {}
        })),
        answers
      });
      const proposal = buildFilterDraftProposal({
        session: {
          name: session.name,
          provider: session.provider,
          scope: session.scope,
          mail_account_ids: session.mail_account_ids ?? []
        },
        analysis: analysisResult.analysis,
        answers
      });

      await saveFilterDraftAnalysis({
        sessionId: session.id,
        status: analysisResult.analysis.questions.length > 0 ? 'questions_pending' : 'ready',
        provider: analysisResult.provider,
        model: analysisResult.model,
        analysis: analysisResult.analysis,
        proposal
      });

      const data = await getFilterDraftSession(session.id);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/filter-drafts/:id/answers', async (req, res, next) => {
    try {
      const session = await getFilterDraftSession(req.params.id);
      if (!session) {
        res.status(404).json({ error: 'Filter draft session not found' });
        return;
      }
      const parsed = filterDraftAnswersPayloadSchema.parse(req.body);
      await upsertFilterDraftAnswers(session.id, parsed.answers);

      const refreshed = await getFilterDraftSession(session.id);
      if (!refreshed || refreshed.samples.length === 0) {
        res.status(400).json({ error: 'Add at least one sample before analysis.' });
        return;
      }

      const answers = toFilterDraftAnswerMap(refreshed);
      const analysisResult = await analyzeFilterDraft({
        session: {
          name: refreshed.name,
          provider: refreshed.provider,
          scope: refreshed.scope,
          mail_account_ids: refreshed.mail_account_ids ?? []
        },
        samples: refreshed.samples.map((sample) => ({
          sample_index: sample.sample_index,
          source_kind: sample.source_kind as 'structured' | 'raw_email' | 'eml',
          raw_source: sample.raw_source,
          filename: sample.filename,
          from_address: sample.from_address ?? '',
          subject: sample.subject ?? '',
          body_text: sample.body_text ?? '',
          body_html: sample.body_html,
          normalized_body: sample.normalized_body,
          parsed_email_json: (sample.parsed_email_json as Record<string, unknown> | null) ?? {}
        })),
        answers
      });
      const proposal = buildFilterDraftProposal({
        session: {
          name: refreshed.name,
          provider: refreshed.provider,
          scope: refreshed.scope,
          mail_account_ids: refreshed.mail_account_ids ?? []
        },
        analysis: analysisResult.analysis,
        answers
      });

      await saveFilterDraftAnalysis({
        sessionId: refreshed.id,
        status: analysisResult.analysis.questions.length > 0 ? 'questions_pending' : 'ready',
        provider: analysisResult.provider,
        model: analysisResult.model,
        analysis: analysisResult.analysis,
        proposal
      });

      const data = await getFilterDraftSession(refreshed.id);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/filter-drafts/:id', async (req, res, next) => {
    try {
      const data = await getFilterDraftSession(req.params.id);
      if (!data) {
        res.status(404).json({ error: 'Filter draft session not found' });
        return;
      }
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/filter-drafts/:id/create-monitor', async (req, res, next) => {
    try {
      const session = await getFilterDraftSession(req.params.id);
      if (!session) {
        res.status(404).json({ error: 'Filter draft session not found' });
        return;
      }
      if (!session.latest_proposal && !req.body?.proposal) {
        res.status(400).json({ error: 'Analyze the draft before creating a monitor.' });
        return;
      }

      const parsed = filterDraftCreateMonitorSchema.parse(req.body ?? {});
      const proposal = parsed.proposal ?? session.latest_proposal?.proposal_json;
      if (!proposal || typeof proposal !== 'object') {
        res.status(400).json({ error: 'A valid proposal is required to create a monitor.' });
        return;
      }

      const proposalData = filterDraftProposalSchema.parse(proposal);
      validateRegexOrThrow(proposalData.subject_regex, 'Subject');
      validateRegexOrThrow(proposalData.body_regex, 'Body');
      if (proposalData.scope === 'selected' && (!proposalData.mail_account_ids || proposalData.mail_account_ids.length === 0)) {
        res.status(400).json({ error: 'scope=selected requires mail_account_ids' });
        return;
      }
      const mailAccountIds = proposalData.mail_account_ids ?? [];
      if (mailAccountIds.length > 0) {
        const providers = await getMailAccountProviders(mailAccountIds);
        const mismatch = providers.some((provider) => provider !== proposalData.provider);
        if (mismatch || providers.length !== mailAccountIds.length) {
          res.status(400).json({ error: 'provider must match linked mail accounts' });
          return;
        }
      }

      const id = `mon_${randomUUID()}`;
      const data = await createMonitor({
        id,
        name: proposalData.name,
        enabled: parsed.enabled ?? false,
        provider: proposalData.provider,
        capture_key: proposalData.capture_key ?? null,
        scope: proposalData.scope,
        mail_account_ids: proposalData.mail_account_ids ?? null,
        sender_rules: proposalData.sender_rules ?? null,
        from_contains: proposalData.from_contains ?? null,
        subject_contains: proposalData.subject_contains ?? null,
        subject_regex: proposalData.subject_regex ?? null,
        body_regex: proposalData.body_regex ?? null,
        has_attachments: proposalData.has_attachments ?? null,
        gmail_label: proposalData.gmail_label ?? null,
        ai_prompt_template: proposalData.ai_prompt_template ?? null,
        confidence_threshold: proposalData.confidence_threshold ?? null,
        allowed_event_types: proposalData.allowed_event_types ?? null
      });

      await markFilterDraftMonitorCreated({ sessionId: session.id, monitorId: data.id });
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/monitors/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      await deleteMonitor(id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/events', async (req, res, next) => {
    try {
      const statusRaw = typeof req.query.status === 'string' ? req.query.status : '';
      const status = statusRaw.toLowerCase();
      const allowedStatuses: EventsOutboxStatus[] = ['pending', 'delivered', 'needs_review', 'rejected'];
      const statusFilter = status
        ? allowedStatuses.includes(status as EventsOutboxStatus)
          ? (status as EventsOutboxStatus)
          : null
        : undefined;
      if (statusFilter === null) {
        res.status(400).json({ error: 'Invalid status. Use pending, delivered, needs_review, or rejected.' });
        return;
      }

      const eventPrefixRaw = typeof req.query.event_prefix === 'string' ? req.query.event_prefix : '';
      const eventPrefix = eventPrefixRaw.trim().toLowerCase();
      const allowedPrefixes = ['amazon', 'manulife', 'orthodontics'] as const;
      const prefixFilter = eventPrefix
        ? allowedPrefixes.includes(eventPrefix as (typeof allowedPrefixes)[number])
          ? (eventPrefix as (typeof allowedPrefixes)[number])
          : null
        : undefined;
      if (prefixFilter === null) {
        res.status(400).json({ error: 'Invalid event_prefix. Use amazon, manulife, or orthodontics.' });
        return;
      }

      const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
      const limit = Number.isFinite(limitRaw) ? Math.trunc(limitRaw as number) : undefined;
      const data = await listEvents({ status: statusFilter, eventTypePrefix: prefixFilter, limit });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  if (hasUi) {
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(uiIndexPath);
    });
  }

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.issues) {
      res.status(400).json({ error: 'Validation failed', details: err.issues });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

function toFilterDraftAnswerMap(session: Awaited<ReturnType<typeof getFilterDraftSession>>): Record<string, unknown> {
  if (!session) return {};
  return session.questions.reduce<Record<string, unknown>>((acc, question) => {
    const answer = (question.answer_json as { value?: unknown } | null)?.value;
    if (answer !== undefined) {
      acc[question.question_key] = answer;
    }
    return acc;
  }, {});
}
