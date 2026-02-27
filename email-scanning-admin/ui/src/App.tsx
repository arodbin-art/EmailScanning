import { NavLink, Route, Routes } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';
import MailAccountsPage from './pages/MailAccountsPage';
import MonitorsPage from './pages/MonitorsPage';
import MonitorEditorPage from './pages/MonitorEditorPage';
import EventsPage from './pages/EventsPage';
import TemplatesPage from './pages/TemplatesPage';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `nav-link${isActive ? ' active' : ''}`;

export default function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Email Admin Hub</div>
        <nav className="nav-links">
          <NavLink to="/admin/dashboard" className={navLinkClass}>
            Dashboard
          </NavLink>
          <NavLink to="/admin/mail-accounts" className={navLinkClass}>
            Mail Accounts
          </NavLink>
          <NavLink to="/admin/monitors" className={navLinkClass}>
            Monitors
          </NavLink>
          <NavLink to="/admin/templates" className={navLinkClass}>
            Templates
          </NavLink>
          <NavLink to="/admin/events" className={navLinkClass}>
            Events
          </NavLink>
        </nav>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/admin/dashboard" element={<DashboardPage />} />
          <Route path="/admin/mail-accounts" element={<MailAccountsPage />} />
          <Route path="/admin/monitors" element={<MonitorsPage />} />
          <Route path="/admin/monitors/:id" element={<MonitorEditorPage />} />
          <Route path="/admin/templates" element={<TemplatesPage />} />
          <Route path="/admin/events" element={<EventsPage />} />
          <Route path="*" element={<DashboardPage />} />
        </Routes>
      </main>
    </div>
  );
}
