import { Dispatch, SetStateAction, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiRequest } from '../utils/api';
import { FilterDraftSession, MailAccount } from '../utils/types';

type SourceKind = 'structured' | 'raw_email';

type SampleDraft = {
  sample_index: 1 | 2;
  enabled: boolean;
  source_kind: SourceKind;
  from: string;
  subject: string;
  body_text: string;
  raw_email: string;
};

const emptySample = (sample_index: 1 | 2): SampleDraft => ({
  sample_index,
  enabled: sample_index === 1,
  source_kind: 'structured',
  from: '',
  subject: '',
  body_text: '',
  raw_email: ''
});

export default function FilterDraftPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';
  const [mailAccounts, setMailAccounts] = useState<MailAccount[]>([]);
  const [session, setSession] = useState<FilterDraftSession | null>(null);
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('');
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const [selectedMailAccountIds, setSelectedMailAccountIds] = useState<number[]>([]);
  const [samples, setSamples] = useState<SampleDraft[]>([emptySample(1), emptySample(2)]);
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdMonitorId, setCreatedMonitorId] = useState<string | null>(null);

  const providers = useMemo(() => {
    return Array.from(new Set(mailAccounts.map((account) => account.provider))).sort();
  }, [mailAccounts]);

  const loadSession = async (sessionId: string) => {
    const response = await apiRequest<FilterDraftSession>(`/api/filter-drafts/${sessionId}`);
    const next = response.data;
    setSession(next);
    setName(next.name);
    setProvider(next.provider);
    setScope(next.scope);
    setSelectedMailAccountIds(next.mail_account_ids ?? []);
    setCreatedMonitorId(next.monitor_id);
    setSamples([
      hydrateSample(next.samples.find((sample) => sample.sample_index === 1), 1),
      hydrateSample(next.samples.find((sample) => sample.sample_index === 2), 2)
    ]);
    setAnswers(
      next.questions.reduce<Record<string, string | boolean>>((acc, question) => {
        const value = question.answer_json?.value;
        if (typeof value === 'string' || typeof value === 'boolean') {
          acc[question.question_key] = value;
        }
        return acc;
      }, {})
    );
  };

  useEffect(() => {
    apiRequest<MailAccount[]>('/api/mail-accounts')
      .then((response) => {
        setMailAccounts(response.data);
        if (!provider && response.data[0]) {
          setProvider(response.data[0].provider);
        }
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!id || id === 'new') return;
    loadSession(id).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load filter draft'));
  }, [id]);

  const filteredMailAccounts = useMemo(() => {
    return mailAccounts.filter((account) => account.provider === provider);
  }, [mailAccounts, provider]);

  const latestAnalysis = session?.latest_summary_json;
  const latestProposal = session?.latest_proposal?.proposal_json ?? null;

  const persistSession = async (): Promise<string> => {
    let sessionId = session?.id;
    if (!sessionId) {
      const created = await apiRequest<FilterDraftSession>('/api/filter-drafts', {
        method: 'POST',
        body: JSON.stringify({
          name,
          provider,
          scope,
          mail_account_ids: scope === 'selected' ? selectedMailAccountIds : []
        })
      });
      sessionId = created.data.id;
      setSession(created.data);
      navigate(`/admin/filter-drafts/${sessionId}`);
    }

    await apiRequest(`/api/filter-drafts/${sessionId}/samples`, {
      method: 'POST',
      body: JSON.stringify({
        samples: samples
          .filter((sample) => sample.enabled)
          .map((sample) =>
            sample.source_kind === 'structured'
              ? {
                  sample_index: sample.sample_index,
                  source_kind: 'structured',
                  from: sample.from,
                  subject: sample.subject,
                  body_text: sample.body_text
                }
              : {
                  sample_index: sample.sample_index,
                  source_kind: 'raw_email',
                  raw_email: sample.raw_email
                }
          )
      })
    });

    return sessionId;
  };

  const saveDraftOnly = async () => {
    setBusy(true);
    setError(null);
    try {
      const sessionId = await persistSession();
      await loadSession(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save draft');
    } finally {
      setBusy(false);
    }
  };

  const analyzeDraft = async () => {
    setBusy(true);
    setError(null);
    try {
      const sessionId = await persistSession();
      await apiRequest(`/api/filter-drafts/${sessionId}/analyze`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      await loadSession(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze draft');
    } finally {
      setBusy(false);
    }
  };

  const submitAnswers = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/filter-drafts/${session.id}/answers`, {
        method: 'POST',
        body: JSON.stringify({
          answers: session.questions
            .map((question) => ({
              question_id: question.question_key,
              value: answers[question.question_key]
            }))
            .filter((entry) => entry.value !== undefined)
        })
      });
      await loadSession(session.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save answers');
    } finally {
      setBusy(false);
    }
  };

  const createMonitor = async () => {
    if (!session || !latestProposal) return;
    setBusy(true);
    setError(null);
    try {
      const created = await apiRequest<{ id: string }>(`/api/filter-drafts/${session.id}/create-monitor`, {
        method: 'POST',
        body: JSON.stringify({ proposal: latestProposal, enabled: false })
      });
      setCreatedMonitorId(created.data.id);
      await loadSession(session.id);
      navigate(`/admin/monitors/${created.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create monitor from proposal');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Create Filter From Sample Emails</h1>
          <div className="helper">Upload or paste 1 to 2 samples, review the extracted structure, then create a disabled draft monitor.</div>
        </div>
        <div className="button-group">
          <button className="button secondary" onClick={() => navigate('/admin/monitors')}>
            Back to monitors
          </button>
          <button className="button ghost" onClick={saveDraftOnly} disabled={busy}>
            Save as draft
          </button>
          <button className="button" onClick={analyzeDraft} disabled={busy}>
            Analyze samples
          </button>
        </div>
      </div>

      {error && <div className="notice">{error}</div>}
      {createdMonitorId && <div className="notice">Monitor created as disabled draft: {createdMonitorId}</div>}

      <div className="card section">
        <div className="form-grid">
          <div className="form-field">
            <label>Draft Name</label>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="form-field">
            <label>Provider</label>
            <select className="select" value={provider} onChange={(event) => setProvider(event.target.value)}>
              {providers.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>Scope</label>
            <select
              className="select"
              value={scope}
              onChange={(event) => setScope(event.target.value === 'selected' ? 'selected' : 'all')}
            >
              <option value="all">All provider accounts</option>
              <option value="selected">Selected accounts</option>
            </select>
          </div>
        </div>

        {scope === 'selected' && (
          <div className="section">
            <div className="helper">Choose the mail account scope for the eventual monitor.</div>
            <div className="inline-list section">
              {filteredMailAccounts.map((account) => (
                <label className="pill" key={account.id}>
                  <input
                    type="checkbox"
                    checked={selectedMailAccountIds.includes(account.id)}
                    onChange={(event) =>
                      setSelectedMailAccountIds((current) =>
                        event.target.checked ? [...current, account.id] : current.filter((id) => id !== account.id)
                      )
                    }
                  />
                  <span style={{ marginLeft: 6 }}>{account.account_label}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card-grid section">
        {samples.map((sample, index) => (
          <div className="card" key={sample.sample_index}>
            <div className="page-header" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Sample Email {index + 1}</h3>
              <label className="helper">
                <input
                  type="checkbox"
                  checked={sample.enabled}
                  onChange={(event) =>
                    setSamples((current) =>
                      current.map((entry) =>
                        entry.sample_index === sample.sample_index
                          ? { ...entry, enabled: event.target.checked || entry.sample_index === 1 }
                          : entry
                      )
                    )
                  }
                  disabled={sample.sample_index === 1}
                />
                <span style={{ marginLeft: 6 }}>{sample.sample_index === 1 ? 'Required' : 'Include sample'}</span>
              </label>
            </div>

            {sample.enabled && (
              <>
                <div className="form-field">
                  <label>Input Type</label>
                  <select
                    className="select"
                    value={sample.source_kind}
                    onChange={(event) =>
                      setSamples((current) =>
                        current.map((entry) =>
                          entry.sample_index === sample.sample_index
                            ? { ...entry, source_kind: event.target.value as SourceKind }
                            : entry
                        )
                      )
                    }
                  >
                    <option value="structured">Structured fields</option>
                    <option value="raw_email">Raw pasted email</option>
                  </select>
                </div>

                {sample.source_kind === 'structured' ? (
                  <div className="form-grid section">
                    <div className="form-field">
                      <label>From</label>
                      <input
                        className="input"
                        value={sample.from}
                        onChange={(event) => updateSample(sample.sample_index, { from: event.target.value }, setSamples)}
                      />
                    </div>
                    <div className="form-field">
                      <label>Subject</label>
                      <input
                        className="input"
                        value={sample.subject}
                        onChange={(event) => updateSample(sample.sample_index, { subject: event.target.value }, setSamples)}
                      />
                    </div>
                    <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                      <label>Body Text</label>
                      <textarea
                        className="textarea"
                        value={sample.body_text}
                        onChange={(event) =>
                          updateSample(sample.sample_index, { body_text: event.target.value }, setSamples)
                        }
                      />
                    </div>
                  </div>
                ) : (
                  <div className="form-field section">
                    <label>Raw Email / .eml Text</label>
                    <textarea
                      className="textarea"
                      value={sample.raw_email}
                      onChange={(event) =>
                        updateSample(sample.sample_index, { raw_email: event.target.value }, setSamples)
                      }
                    />
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {latestAnalysis && (
        <div className="card-grid section">
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Extracted Structure</h3>
            <div className="helper">Monitor suggestion: {latestAnalysis.monitor_name_suggestion}</div>
            <div className="helper">Capture key: {latestAnalysis.capture_key_suggestion || '-'}</div>
            <div className="helper">Parser family: {latestAnalysis.parser_family_guess || '-'}</div>
            <div className="helper">Event type: {latestAnalysis.event_type_guess || '-'}</div>
            <div className="helper">Confidence: {(latestAnalysis.confidence * 100).toFixed(0)}%</div>
            <div className="section">
              <div className="helper">Stable patterns</div>
              <div className="inline-list">
                {latestAnalysis.stable_tokens.map((token) => (
                  <span className="pill" key={token}>
                    {token}
                  </span>
                ))}
              </div>
            </div>
            <div className="section">
              <div className="helper">Variable tokens</div>
              <div className="inline-list">
                {latestAnalysis.variable_tokens.map((token) => (
                  <span className="pill" key={token}>
                    {token}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Draft Proposal</h3>
            {latestProposal ? (
              <>
                <div className="helper">Name: {latestProposal.name}</div>
                <div className="helper">Capture key: {latestProposal.capture_key || '-'}</div>
                <div className="helper">Subject regex: {latestProposal.subject_regex || '-'}</div>
                <div className="helper">Body regex: {latestProposal.body_regex || '-'}</div>
                <div className="helper">
                  Allowed event types: {latestProposal.allowed_event_types?.join(', ') || '-'}
                </div>
                <div className="section">
                  <pre className="json-preview">{JSON.stringify(latestProposal, null, 2)}</pre>
                </div>
                <div className="button-group">
                  <button className="button" onClick={createMonitor} disabled={busy}>
                    Create monitor from proposal
                  </button>
                  <button className="button secondary" onClick={() => navigate('/admin/monitors/new')}>
                    Create blank monitor instead
                  </button>
                </div>
              </>
            ) : (
              <div className="helper">Analyze the samples to generate a draft proposal.</div>
            )}
          </div>
        </div>
      )}

      {session && session.questions.length > 0 && (
        <div className="card section">
          <div className="page-header" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Follow-up Questions</h3>
            <button className="button" onClick={submitAnswers} disabled={busy}>
              Continue answering questions
            </button>
          </div>
          {session.questions.map((question) => (
            <div className="form-field section" key={question.id}>
              <label>{question.question_json.question}</label>
              <span className="helper">{question.question_json.reason}</span>
              {renderQuestionInput(question.question_json, answers[question.question_key], (value) =>
                setAnswers((current) => ({ ...current, [question.question_key]: value }))
              )}
            </div>
          ))}
        </div>
      )}

      {latestAnalysis?.fields_detected && latestAnalysis.fields_detected.length > 0 && (
        <div className="card section">
          <h3 style={{ marginTop: 0 }}>Detected Fields</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Value</th>
                <th>Source</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {latestAnalysis.fields_detected.map((field) => (
                <tr key={`${field.field}:${field.value}`}>
                  <td>{field.field}</td>
                  <td>{field.value}</td>
                  <td>{field.source}</td>
                  <td>{field.confidence.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function hydrateSample(
  source: FilterDraftSession['samples'][number] | undefined,
  sampleIndex: 1 | 2
): SampleDraft {
  if (!source) return emptySample(sampleIndex);
  const parsed = source.raw_source.includes('\nFrom:') || source.raw_source.includes('Subject:')
    ? { source_kind: 'raw_email' as const }
    : { source_kind: 'structured' as const };
  return {
    sample_index: sampleIndex,
    enabled: true,
    source_kind: parsed.source_kind,
    from: source.from_address || '',
    subject: source.subject || '',
    body_text: source.body_text || source.normalized_body,
    raw_email: source.raw_source
  };
}

function updateSample(
  sampleIndex: number,
  patch: Partial<SampleDraft>,
  setSamples: Dispatch<SetStateAction<SampleDraft[]>>
) {
  setSamples((current) =>
    current.map((entry) => (entry.sample_index === sampleIndex ? { ...entry, ...patch } : entry))
  );
}

function renderQuestionInput(
  question: FilterDraftSession['questions'][number]['question_json'],
  value: string | boolean | undefined,
  onChange: (value: string | boolean) => void
) {
  if (question.answer_type === 'boolean') {
    return (
      <select
        className="select"
        value={value === undefined ? '' : String(value)}
        onChange={(event) => onChange(event.target.value === 'true')}
      >
        <option value="">Select</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  if (question.answer_type === 'single_select') {
    return (
      <select className="select" value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select</option>
        {question.options?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input className="input" value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} />
  );
}
