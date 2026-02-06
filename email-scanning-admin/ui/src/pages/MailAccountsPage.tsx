import { useEffect, useState } from 'react';
import { apiRequest } from '../utils/api';
import { MailAccount } from '../utils/types';

const emptyForm = {
  provider: '',
  account_label: '',
  mailbox_address: '',
  auth_type: 'graph',
  enabled: true
};

export default function MailAccountsPage() {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [form, setForm] = useState({ ...emptyForm });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAccounts = () => {
    apiRequest<MailAccount[]>('/api/mail-accounts')
      .then((res) => setAccounts(res.data))
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const startEdit = (account: MailAccount) => {
    setEditingId(account.id);
    setForm({
      provider: account.provider,
      account_label: account.account_label,
      mailbox_address: account.mailbox_address,
      auth_type: account.auth_type,
      enabled: account.enabled
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
  };

  const submitForm = async () => {
    setError(null);
    const payload = { ...form };
    try {
      if (editingId) {
        await apiRequest(`/api/mail-accounts/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        await apiRequest('/api/mail-accounts', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
      resetForm();
      loadAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    }
  };

  const deleteAccount = async (id: number) => {
    if (!confirm('Delete this mail account?')) return;
    try {
      await apiRequest(`/api/mail-accounts/${id}`, { method: 'DELETE' });
      loadAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Mail Accounts</h1>
      </div>
      {error && <div className="notice">{error}</div>}
      <div className="card section">
        <div className="form-grid">
          <div className="form-field">
            <label>Provider</label>
            <input
              className="input"
              value={form.provider}
              onChange={(event) => setForm({ ...form, provider: event.target.value })}
            />
          </div>
          <div className="form-field">
            <label>Account Label</label>
            <input
              className="input"
              value={form.account_label}
              onChange={(event) => setForm({ ...form, account_label: event.target.value })}
            />
          </div>
          <div className="form-field">
            <label>Mailbox Address</label>
            <input
              className="input"
              value={form.mailbox_address}
              onChange={(event) => setForm({ ...form, mailbox_address: event.target.value })}
            />
          </div>
          <div className="form-field">
            <label>Auth Type</label>
            <input
              className="input"
              value={form.auth_type}
              onChange={(event) => setForm({ ...form, auth_type: event.target.value })}
            />
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
        </div>
        <div className="button-group section">
          <button className="button" onClick={submitForm}>
            {editingId ? 'Update Account' : 'Create Account'}
          </button>
          <button className="button secondary" onClick={resetForm}>
            Clear
          </button>
        </div>
        <p className="helper">Secrets never surface in the UI. Credential references are managed separately.</p>
      </div>

      <div className="card section">
        <table className="table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Provider</th>
              <th>Address</th>
              <th>Enabled</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id}>
                <td>{account.account_label}</td>
                <td>{account.provider}</td>
                <td>{account.mailbox_address}</td>
                <td>
                  <span className={`badge ${account.enabled ? 'success' : 'disabled'}`}>
                    {account.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </td>
                <td>
                  <div className="button-group">
                    <button className="button ghost" onClick={() => startEdit(account)}>
                      Edit
                    </button>
                    <button className="button danger" onClick={() => deleteAccount(account.id)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={5}>No mail accounts configured.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
