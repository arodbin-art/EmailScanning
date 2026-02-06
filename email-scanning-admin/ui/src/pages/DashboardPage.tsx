import { useEffect, useState } from 'react';
import { apiRequest } from '../utils/api';
import { MailAccount, Monitor } from '../utils/types';

export default function DashboardPage() {
  const [mailAccounts, setMailAccounts] = useState<MailAccount[]>([]);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [error, setError] = useState<string | null>(null);

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
      </div>
    </div>
  );
}
