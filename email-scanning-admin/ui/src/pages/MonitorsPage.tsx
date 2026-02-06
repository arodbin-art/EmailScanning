import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../utils/api';
import { MailAccount, Monitor } from '../utils/types';

function summarizeMonitor(monitor: Monitor) {
  const rules: string[] = [];
  if (Array.isArray(monitor.sender_rules) ? monitor.sender_rules.length > 0 : !!monitor.sender_rules) {
    rules.push('sender rules');
  }
  if (monitor.from_contains) {
    rules.push(`from contains "${monitor.from_contains}"`);
  }
  if (monitor.subject_contains) {
    rules.push(`subject contains "${monitor.subject_contains}"`);
  }
  if (monitor.subject_regex) {
    rules.push(`subject /${monitor.subject_regex}/`);
  }
  if (monitor.body_regex) {
    rules.push(`body /${monitor.body_regex}/`);
  }
  if (monitor.has_attachments === true) {
    rules.push('has attachments');
  }
  if (monitor.has_attachments === false) {
    rules.push('no attachments');
  }
  if (monitor.gmail_label) {
    rules.push(`label "${monitor.gmail_label}"`);
  }
  return rules.length > 0 ? rules.join(' · ') : 'No rules defined';
}

export default function MonitorsPage() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [mailAccounts, setMailAccounts] = useState<MailAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const navigate = useNavigate();

  const loadData = () => {
    Promise.all([
      apiRequest<Monitor[]>('/api/monitors'),
      apiRequest<MailAccount[]>('/api/mail-accounts')
    ])
      .then(([monitorRes, mailRes]) => {
        setMonitors(monitorRes.data);
        setMailAccounts(mailRes.data);
        setWarnings(monitorRes.warnings?.map((warning) => warning.message) ?? []);
      })
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    loadData();
  }, []);

  const accountLookup = useMemo(() => {
    return new Map(mailAccounts.map((account) => [account.id, account]));
  }, [mailAccounts]);

  const duplicateMonitor = async (monitor: Monitor) => {
    setError(null);
    try {
      await apiRequest('/api/monitors', {
        method: 'POST',
        body: JSON.stringify({
          name: `${monitor.name} (Copy)`,
          enabled: monitor.enabled,
          provider: monitor.provider,
          scope: monitor.scope,
          mail_account_ids: monitor.mail_account_ids,
          sender_rules: monitor.sender_rules,
          from_contains: monitor.from_contains,
          subject_contains: monitor.subject_contains,
          subject_regex: monitor.subject_regex,
          body_regex: monitor.body_regex,
          has_attachments: monitor.has_attachments,
          gmail_label: monitor.gmail_label,
          ai_prompt_template: monitor.ai_prompt_template,
          confidence_threshold: monitor.confidence_threshold,
          allowed_event_types: monitor.allowed_event_types
        })
      });
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to duplicate monitor');
    }
  };

  const deleteMonitor = async (id: string) => {
    if (!confirm('Delete this monitor?')) return;
    try {
      await apiRequest(`/api/monitors/${id}`, { method: 'DELETE' });
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete monitor');
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Monitors</h1>
        <button className="button" onClick={() => navigate('/admin/monitors/new')}>
          Create Monitor
        </button>
      </div>
      {error && <div className="notice">{error}</div>}
      {warnings.length > 0 && (
        <div className="notice">
          {warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      )}
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Provider</th>
              <th>Scope</th>
              <th>Mail Accounts</th>
              <th>Rule Summary</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {monitors.map((monitor) => (
              <tr key={monitor.id}>
                <td>{monitor.name}</td>
                <td>
                  <span className={`badge ${monitor.enabled ? 'success' : 'disabled'}`}>
                    {monitor.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </td>
                <td>{monitor.provider}</td>
                <td>{monitor.scope}</td>
                <td>
                  <div className="inline-list">
                    {(monitor.mail_account_ids || []).map((id) => {
                      const account = accountLookup.get(id);
                      return (
                        <span className="pill" key={id}>
                          {account ? account.account_label : `#${id}`}
                        </span>
                      );
                    })}
                    {(!monitor.mail_account_ids || monitor.mail_account_ids.length === 0) && 'All'}
                  </div>
                </td>
                <td>{summarizeMonitor(monitor)}</td>
                <td>
                  <div className="button-group">
                    <button
                      className="button ghost"
                      onClick={() => navigate(`/admin/monitors/${monitor.id}`)}
                    >
                      Edit
                    </button>
                    <button className="button secondary" onClick={() => duplicateMonitor(monitor)}>
                      Duplicate
                    </button>
                    <button className="button danger" onClick={() => deleteMonitor(monitor.id)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {monitors.length === 0 && (
              <tr>
                <td colSpan={7}>No monitors configured.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
