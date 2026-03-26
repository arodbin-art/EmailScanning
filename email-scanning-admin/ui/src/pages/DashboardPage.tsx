import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../utils/api';
import { MailAccount, Monitor } from '../utils/types';

export default function DashboardPage() {
  const [mailAccounts, setMailAccounts] = useState<MailAccount[]>([]);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    Promise.all([
      apiRequest<MailAccount[]>('/api/mail-accounts'),
      apiRequest<Monitor[]>('/api/monitors')
    ])
      .then(([mailRes, monitorRes]) => {
        if (!active) return;
        setMailAccounts(mailRes.data);
        setMonitors(monitorRes.data);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message);
      });
    return () => {
      active = false;
    };
  }, []);

  const enabledAccounts = mailAccounts.filter((account) => account.enabled).length;
  const enabledMonitors = monitors.filter((monitor) => monitor.enabled).length;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
      </div>
      {error && <div className="notice">{error}</div>}
      <div className="card-grid">
        <div className="card metric">
          <span className="metric-label">Mail Accounts</span>
          <span className="metric-value">{mailAccounts.length}</span>
          <span className="helper">Enabled: {enabledAccounts}</span>
        </div>
        <div className="card metric">
          <span className="metric-label">Monitors</span>
          <span className="metric-value">{monitors.length}</span>
          <span className="helper">Enabled: {enabledMonitors}</span>
        </div>
        <div className="card metric">
          <span className="metric-label">Disabled</span>
          <span className="metric-value">
            {mailAccounts.length - enabledAccounts + (monitors.length - enabledMonitors)}
          </span>
          <span className="helper">Across accounts + monitors</span>
        </div>
        <div className="card metric">
          <span className="metric-label">Template AI</span>
          <span className="metric-value">New</span>
          <span className="helper">Build a monitor from sample emails</span>
          <div className="button-group" style={{ marginTop: '0.75rem' }}>
            <button className="button secondary" onClick={() => navigate('/admin/filter-drafts/new')}>
              Open Template AI
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
