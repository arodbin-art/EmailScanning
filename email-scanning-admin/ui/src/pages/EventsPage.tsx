import { useEffect, useState } from 'react';
import { apiRequest } from '../utils/api';
import { EventStatus, MailAccount, SignalEvent } from '../utils/types';

const statuses: Array<{ label: string; value: '' | EventStatus }> = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'pending' },
  { label: 'Delivered', value: 'delivered' },
  { label: 'Needs Review', value: 'needs_review' },
  { label: 'Rejected', value: 'rejected' }
];

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function jsonPreview(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function EventsPage() {
  const [events, setEvents] = useState<SignalEvent[]>([]);
  const [mailAccounts, setMailAccounts] = useState<MailAccount[]>([]);
  const [status, setStatus] = useState<'' | EventStatus>('');
  const [eventPrefix, setEventPrefix] = useState<'' | 'amazon' | 'manulife'>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<MailAccount[]>('/api/mail-accounts')
      .then((response) => setMailAccounts(response.data))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ limit: '300' });
    if (status) {
      params.set('status', status);
    }
    if (eventPrefix) {
      params.set('event_prefix', eventPrefix);
    }

    apiRequest<SignalEvent[]>(`/api/events?${params.toString()}`)
      .then((response) => {
        setEvents(response.data);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load events'));
  }, [status, eventPrefix]);

  const missingPersonCodes = mailAccounts.filter(
    (account) =>
      account.provider.toLowerCase() === 'gmail' &&
      !account.moneyrecovery_person_code
  );

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Events</h1>
      </div>

      <div className="tabs">
        {statuses.map((tab) => (
          <button
            key={tab.label}
            className={`tab ${status === tab.value ? 'active' : ''}`}
            onClick={() => setStatus(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="form-field section" style={{ maxWidth: 280 }}>
        <label>Event Family</label>
        <select
          className="select"
          value={eventPrefix}
          onChange={(event) =>
            setEventPrefix(event.target.value as '' | 'amazon' | 'manulife')
          }
        >
          <option value="">All</option>
          <option value="amazon">Amazon</option>
          <option value="manulife">Manulife</option>
        </select>
      </div>

      {missingPersonCodes.length > 0 && (
        <div className="notice">
          Amazon automation warning: {missingPersonCodes.length} Gmail account(s) have no
          MoneyRecovery person code mapping. No-match Amazon events will be set to needs_review.
        </div>
      )}

      {error && <div className="notice">{error}</div>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Status</th>
              <th>Event</th>
              <th>Email Subject</th>
              <th>Email From</th>
              <th>Email Received</th>
              <th>Created</th>
              <th>Delivered</th>
              <th>Confidence</th>
              <th>Delivery Response</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>{event.id}</td>
                <td>
                  <span className={`badge event-${event.status}`}>{event.status}</span>
                </td>
                <td>{event.event_type}</td>
                <td>{event.email_subject || '—'}</td>
                <td>{event.email_from || '—'}</td>
                <td>{formatDate(event.email_received_at)}</td>
                <td>{formatDate(event.created_at)}</td>
                <td>{formatDate(event.delivered_at)}</td>
                <td>{event.confidence ?? '—'}</td>
                <td>
                  <pre className="code compact">{jsonPreview(event.rvi_response)}</pre>
                </td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={10}>No events found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
