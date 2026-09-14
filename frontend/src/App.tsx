import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { SystemOverviewPage } from './pages/SystemOverviewPage';
import { TopologyPage } from './pages/TopologyPage';
import { ServiceDetailPage } from './pages/ServiceDetailPage';
import { AssistantPage } from './pages/AssistantPage';
import { SimulationPage } from './pages/SimulationPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { IncidentDetailPage } from './pages/IncidentDetailPage';
import { ExecutionsPage } from './pages/ExecutionsPage';
import { ExecutionDetailPage } from './pages/ExecutionDetailPage';

/**
 * `/login` and `/register` are the only routes reachable without a
 * session. Everything else is wrapped in `<RequireAuth>` (UX-only
 * redirect-to-login, see auth/RequireAuth.tsx) and `<Layout>` (the sidebar
 * nav shared by every authenticated page), so every one of the 7 planned
 * views (docs/phases.md row 17) shares one shell instead of re-declaring
 * its own chrome.
 */
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route
        path="/*"
        element={
          <RequireAuth>
            <Layout>
              <Routes>
                <Route path="/" element={<SystemOverviewPage />} />
                <Route path="/topology" element={<TopologyPage />} />
                <Route path="/services/:name" element={<ServiceDetailPage />} />
                <Route path="/assistant" element={<AssistantPage />} />
                <Route path="/simulation" element={<SimulationPage />} />
                <Route path="/incidents" element={<IncidentsPage />} />
                <Route path="/incidents/:id" element={<IncidentDetailPage />} />
                <Route path="/executions" element={<ExecutionsPage />} />
                <Route path="/executions/:id" element={<ExecutionDetailPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
