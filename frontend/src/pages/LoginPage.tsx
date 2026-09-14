import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { Button } from '../components/ui/Button';
import { IconAssistant } from '../components/icons';

interface LocationState {
  from?: { pathname: string };
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);
    try {
      await login(email, password);
      const state = location.state as LocationState | null;
      navigate(state?.from?.pathname ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="card card--padded auth-card">
        <div className="auth-brand">
          <span className="auth-brand__mark" aria-hidden>
            <IconAssistant size={18} />
          </span>
          AI Digital Twin
        </div>
        <p className="text-secondary auth-subtitle">AI-powered infrastructure intelligence</p>

        <form onSubmit={handleSubmit} className="stack" style={{ gap: 'var(--space-4)', marginTop: 'var(--space-6)' }}>
          <div className="field">
            <label className="field__label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              className="input"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              className="input"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <div role="alert" className="form-error">
              {error}
            </div>
          )}
          <Button type="submit" variant="primary" disabled={submitting} style={{ width: '100%' }}>
            {submitting ? 'Logging in…' : 'Log in'}
          </Button>
        </form>

        <p className="auth-footer text-secondary">
          Don&rsquo;t have an account? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  );
}
