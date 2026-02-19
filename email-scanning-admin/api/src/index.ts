import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { validateSchemaOrThrow } from './db.js';
import { requireAdmin } from './auth.js';
import {
  mailAccountInputSchema,
  monitorInputSchema,
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

const app = express();
app.use(express.json({ limit: '1mb' }));

const uiDistPath = process.env.UI_DIST_PATH || path.join(process.cwd(), 'ui-dist');
const uiIndexPath = path.join(uiDistPath, 'index.html');
const hasUi = fs.existsSync(uiIndexPath);

if (!process.env.ADMIN_TOKEN) {
  console.error('Startup failed: ADMIN_TOKEN is required.');
  process.exit(1);
}

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

// When deployed as a single container, serve the React UI from the API process.
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
    const warnings = data.flatMap((monitor) =>
      buildAiWarnings(monitor.ai_prompt_template, aiEnabled)
    );
    res.json({ data, warnings });
  } catch (err) {
    next(err);
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
    const statusFilter = status ? (allowedStatuses.includes(status as EventsOutboxStatus) ? (status as EventsOutboxStatus) : null) : undefined;
    if (statusFilter === null) {
      res.status(400).json({ error: 'Invalid status. Use pending, delivered, needs_review, or rejected.' });
      return;
    }

    const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const limit = Number.isFinite(limitRaw) ? Math.trunc(limitRaw as number) : undefined;
    const data = await listEvents({ status: statusFilter, limit });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// SPA fallback for non-API routes (admin pages).
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

const port = Number(process.env.PORT) || 4000;

validateSchemaOrThrow()
  .then(() => {
    app.listen(port, () => {
      console.log(`Email Scanning Admin API listening on ${port}`);
    });
  })
  .catch((err) => {
    console.error('Startup failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
