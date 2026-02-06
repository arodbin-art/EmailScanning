import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiRequest } from '../utils/api';
import { MailAccount, Monitor } from '../utils/types';

const defaultForm = {
  name: '',
  enabled: true,
  provider: '',
  scope: 'all' as const,
  mail_account_ids: [] as number[],
  sender_rules: [] as string[],
  from_contains: '',
  subject_contains: '',
  subject_regex: '',
  body_regex: '',
  has_attachments: null as null | boolean,
  gmail_label: '',
  ai_prompt_template: '',
  confidence_threshold: 0.7,
  allowed_event_types: [] as string[]
};

type EditorMode = 'visual' | 'json';

type FormState = typeof defaultForm;

type ValidationResult = {
  errors: string[];
  payload?: Record<string, unknown>;
};

function parseSenderRules(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatSenderRules(rules: unknown): string {
  if (Array.isArray(rules)) {
    return rules.map((rule) => String(rule)).join('\n');
  }
  if (!rules) return '';
  return JSON.stringify(rules, null, 2);
}

function validateRegex(value: string, label: string, errors: string[]) {
  if (!value) return;
  try {
    new RegExp(value);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid regex';
    errors.push(`${label} regex invalid: ${message}`);
  }
}

function validateMonitorPayload(payload: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  if (typeof payload.name !== 'string' || payload.name.trim().length === 0) {
    errors.push('Name is required.');
  }
  if (typeof payload.provider !== 'string' || payload.provider.trim().length === 0) {
    errors.push('Provider is required.');
  }
  if (payload.scope !== 'all' && payload.scope !== 'selected') {
    errors.push('Scope must be all or selected.');
  }
  if (payload.scope === 'selected') {
    const ids = Array.isArray(payload.mail_account_ids) ? payload.mail_account_ids : [];
    if (ids.length === 0) {
      errors.push('Selected scope requires mail account ids.');
    }
  }

  if (payload.confidence_threshold !== null && payload.confidence_threshold !== undefined) {
    const value = Number(payload.confidence_threshold);
    if (Number.isNaN(value) || value < 0 || value > 1) {
      errors.push('Confidence threshold must be between 0 and 1.');
    }
  }

  if (typeof payload.subject_regex === 'string') {
    validateRegex(payload.subject_regex, 'Subject', errors);
  }
  if (typeof payload.body_regex === 'string') {
    validateRegex(payload.body_regex, 'Body', errors);
  }

  return { errors, payload };
}

export default function MonitorEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'new';
  const [form, setForm] = useState<FormState>({ ...defaultForm });
  const [senderRulesText, setSenderRulesText] = useState('');
  const [mode, setMode] = useState<EditorMode>('visual');
  const [jsonText, setJsonText] = useState('');
  const [mailAccounts, setMailAccounts] = useState<MailAccount[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const providers = useMemo(() => {
    const set = new Set(mailAccounts.map((account) => account.provider));
    return Array.from(set).sort();
  }, [mailAccounts]);

  const subjectRegexError = useMemo(() => {
    if (!form.subject_regex) return '';
    try {
      new RegExp(form.subject_regex);
      return '';
    } catch (err) {
      return err instanceof Error ? err.message : 'Invalid regex';
    }
  }, [form.subject_regex]);

  const bodyRegexError = useMemo(() => {
    if (!form.body_regex) return '';
    try {
      new RegExp(form.body_regex);
      return '';
    } catch (err) {
      return err instanceof Error ? err.message : 'Invalid regex';
    }
  }, [form.body_regex]);

  useEffect(() => {
    const stored = localStorage.getItem(`monitor-editor-mode-${id}`) as EditorMode | null;
    if (stored) {
      setMode(stored);
    }
  }, [id]);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiRequest<Monitor[]>('/api/monitors'),
      apiRequest<MailAccount[]>('/api/mail-accounts')
    ])
      .then(([monitorRes, mailRes]) => {
        if (!active) return;
        setMailAccounts(mailRes.data);
        if (isNew) {
          setForm({ ...defaultForm, provider: mailRes.data[0]?.provider || '' });
          setSenderRulesText('');
          setJsonText(JSON.stringify(defaultForm, null, 2));
        } else {
          const target = monitorRes.data.find((monitor) => monitor.id === id);
          if (target) {
          const nextForm: FormState = {
              name: target.name,
              enabled: target.enabled,
              provider: target.provider,
              scope: target.scope,
              mail_account_ids: target.mail_account_ids || [],
              sender_rules: Array.isArray(target.sender_rules)
                ? (target.sender_rules as string[])
                : [],
              from_contains: target.from_contains || '',
              subject_contains: target.subject_contains || '',
              subject_regex: target.subject_regex || '',
              body_regex: target.body_regex || '',
              has_attachments:
                target.has_attachments === null || target.has_attachments === undefined
                  ? null
                  : target.has_attachments,
              gmail_label: target.gmail_label || '',
              ai_prompt_template: target.ai_prompt_template || '',
              confidence_threshold: target.confidence_threshold ?? 0.7,
              allowed_event_types: target.allowed_event_types || []
            };
            setForm(nextForm);
            setSenderRulesText(formatSenderRules(target.sender_rules));
            setJsonText(JSON.stringify(toPayload(nextForm), null, 2));
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setErrors([err.message]);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, isNew]);

  const accountLookup = useMemo(() => {
    return new Map(mailAccounts.map((account) => [account.id, account]));
  }, [mailAccounts]);

  const toggleMode = (next: EditorMode) => {
    setMode(next);
    localStorage.setItem(`monitor-editor-mode-${id}`, next);
    if (next === 'json') {
      setJsonText(JSON.stringify(toPayload(form), null, 2));
    }
  };

  const toPayload = (state: FormState) => ({
    name: state.name.trim(),
    enabled: state.enabled,
    provider: state.provider.trim(),
    scope: state.scope,
    mail_account_ids: state.scope === 'selected' ? state.mail_account_ids : [],
    sender_rules: state.sender_rules,
    from_contains: state.from_contains.trim() || null,
    subject_contains: state.subject_contains.trim() || null,
    subject_regex: state.subject_regex.trim() || null,
    body_regex: state.body_regex.trim() || null,
    has_attachments: state.has_attachments,
    gmail_label: state.gmail_label.trim() || null,
    ai_prompt_template: state.ai_prompt_template.trim() || null,
    confidence_threshold: state.confidence_threshold,
    allowed_event_types: state.allowed_event_types
  });

  const validateVisual = (): ValidationResult => {
    const payload = toPayload(form);
    const result = validateMonitorPayload(payload);

    if (payload.provider && payload.mail_account_ids && payload.mail_account_ids.length > 0) {
      const providersMatch = payload.mail_account_ids.every((accountId) => {
        const account = accountLookup.get(accountId);
        return account?.provider === payload.provider;
      });
      if (!providersMatch) {
        result.errors.push('Provider must match linked mail accounts.');
      }
    }

    return result;
  };

  const validateJson = (): ValidationResult => {
    try {
      const parsed = JSON.parse(jsonText);
      return validateMonitorPayload(parsed);
    } catch (err) {
      return {
        errors: ['JSON is invalid.'],
        payload: undefined
      };
    }
  };

  const saveMonitor = async () => {
    setErrors([]);
    setWarnings([]);

    const validation = mode === 'json' ? validateJson() : validateVisual();
    if (validation.errors.length > 0 || !validation.payload) {
      setErrors(validation.errors);
      return;
    }

    try {
      const result = await apiRequest<Monitor>(
        isNew ? '/api/monitors' : `/api/monitors/${id}`,
        {
          method: isNew ? 'POST' : 'PUT',
          body: JSON.stringify(validation.payload)
        }
      );
      if (result.warnings) {
        setWarnings(result.warnings.map((warning) => warning.message));
      }
      if (isNew && result.data?.id) {
        navigate(`/admin/monitors/${result.data.id}`);
      }
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Save failed']);
    }
  };

  const exportJson = () => {
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `monitor-${id || 'new'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((text) => setJsonText(text));
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Monitor Editor</h1>
        <div className="button-group">
          <button className="button secondary" onClick={() => navigate('/admin/monitors')}>
            Back to monitors
          </button>
          <button className="button" onClick={saveMonitor}>
            {isNew ? 'Create Monitor' : 'Save Changes'}
          </button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="notice">
          {warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      )}
      {errors.length > 0 && mode !== 'json' && (
        <div className="notice">
          {errors.map((error) => (
            <div key={error}>{error}</div>
          ))}
        </div>
      )}

      <div className="tabs">
        <button className={`tab ${mode === 'visual' ? 'active' : ''}`} onClick={() => toggleMode('visual')}>
          Visual Form
        </button>
        <button className={`tab ${mode === 'json' ? 'active' : ''}`} onClick={() => toggleMode('json')}>
          Raw JSON
        </button>
      </div>

      {mode === 'visual' && (
        <div className="card">
          <div className="form-grid">
            <div className="form-field">
              <label>Name</label>
              <input
                className="input"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div className="form-field">
              <label>Provider</label>
              <input
                className="input"
                value={form.provider}
                onChange={(event) => setForm({ ...form, provider: event.target.value })}
                list="provider-options"
              />
              <datalist id="provider-options">
                {providers.map((provider) => (
                  <option key={provider} value={provider} />
                ))}
              </datalist>
            </div>
            <div className="form-field">
              <label>Enabled</label>
              <select
                className="select"
                value={form.enabled ? 'true' : 'false'}
                onChange={(event) => setForm({ ...form, enabled: event.target.value === 'true' })}
              >
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </div>
            <div className="form-field">
              <label>Scope</label>
              <select
                className="select"
                value={form.scope}
                onChange={(event) =>
                  setForm({
                    ...form,
                    scope: event.target.value === 'selected' ? 'selected' : 'all'
                  })
                }
              >
                <option value="all">All</option>
                <option value="selected">Selected</option>
              </select>
            </div>
            <div className="form-field">
              <label>Confidence Threshold</label>
              <input
                className="input"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={form.confidence_threshold}
                onChange={(event) =>
                  setForm({ ...form, confidence_threshold: Number(event.target.value) })
                }
              />
              <span className="helper">{form.confidence_threshold.toFixed(2)}</span>
            </div>
          </div>

          {form.scope === 'selected' && (
            <div className="section">
              <div className="form-field">
                <label>Mail Accounts</label>
                <div className="inline-list">
                  {mailAccounts.map((account) => (
                    <label key={account.id} className="pill">
                      <input
                        type="checkbox"
                        checked={form.mail_account_ids.includes(account.id)}
                        onChange={(event) => {
                          const next = event.target.checked
                            ? [...form.mail_account_ids, account.id]
                            : form.mail_account_ids.filter((value) => value !== account.id);
                          setForm({ ...form, mail_account_ids: next });
                        }}
                      />
                      {account.account_label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="section">
            <div className="form-grid">
              <div className="form-field">
                <label>Sender Rules (one per line)</label>
                <textarea
                  className="textarea"
                  value={senderRulesText}
                  onChange={(event) => {
                    setSenderRulesText(event.target.value);
                    setForm({ ...form, sender_rules: parseSenderRules(event.target.value) });
                  }}
                />
              </div>
              <div className="form-field">
                <label>Allowed Event Types (comma separated)</label>
                <textarea
                  className="textarea"
                  value={form.allowed_event_types.join(', ')}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      allowed_event_types: event.target.value
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean)
                    })
                  }
                />
              </div>
            </div>
          </div>

          <div className="section">
            <div className="form-grid">
              <div className="form-field">
                <label>From Contains</label>
                <input
                  className="input"
                  value={form.from_contains}
                  onChange={(event) => setForm({ ...form, from_contains: event.target.value })}
                />
                <span className="helper">Simple substring match (case-insensitive).</span>
              </div>
              <div className="form-field">
                <label>Subject Contains</label>
                <input
                  className="input"
                  value={form.subject_contains}
                  onChange={(event) => setForm({ ...form, subject_contains: event.target.value })}
                />
              </div>
              <div className="form-field">
                <label>Subject Regex</label>
                <input
                  className="input"
                  value={form.subject_regex}
                  onChange={(event) => setForm({ ...form, subject_regex: event.target.value })}
                />
                {subjectRegexError && <span className="error">{subjectRegexError}</span>}
              </div>
              <div className="form-field">
                <label>Body Regex</label>
                <input
                  className="input"
                  value={form.body_regex}
                  onChange={(event) => setForm({ ...form, body_regex: event.target.value })}
                />
                {bodyRegexError && <span className="error">{bodyRegexError}</span>}
              </div>
              <div className="form-field">
                <label>Has Attachments</label>
                <select
                  className="select"
                  value={form.has_attachments === null ? 'any' : form.has_attachments ? 'true' : 'false'}
                  onChange={(event) => {
                    const value = event.target.value;
                    setForm({
                      ...form,
                      has_attachments: value === 'any' ? null : value === 'true'
                    });
                  }}
                >
                  <option value="any">Any</option>
                  <option value="true">Required</option>
                  <option value="false">Must not</option>
                </select>
              </div>
              <div className="form-field">
                <label>Gmail Label</label>
                <input
                  className="input"
                  value={form.gmail_label}
                  onChange={(event) => setForm({ ...form, gmail_label: event.target.value })}
                />
                <span className="helper">Optional label match (Gmail only).</span>
              </div>
            </div>
          </div>

          <div className="section">
            <div className="form-field">
              <label>AI Prompt Template</label>
              <textarea
                className="textarea"
                value={form.ai_prompt_template}
                onChange={(event) => setForm({ ...form, ai_prompt_template: event.target.value })}
              />
            </div>
          </div>
        </div>
      )}

      {mode === 'json' && (
        <div className="card">
          <div className="button-group">
            <label className="button ghost">
              Import JSON
              <input type="file" hidden accept="application/json" onChange={importJson} />
            </label>
            <button className="button secondary" onClick={exportJson}>
              Export JSON
            </button>
          </div>
          <div className="section">
            <textarea
              className="textarea"
              value={jsonText}
              onChange={(event) => setJsonText(event.target.value)}
              style={{ minHeight: '320px' }}
            />
          </div>
          {errors.length > 0 && (
            <div className="section">
              {errors.map((error) => (
                <div className="error" key={error}>
                  {error}
                </div>
              ))}
            </div>
          )}
          <div className="section">
            <div className="helper">
              JSON mode accepts the full monitor payload. Validation happens on save.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
