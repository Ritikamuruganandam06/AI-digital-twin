import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { Button } from '../components/ui/Button';
import { IconAssistant } from '../components/icons';
import type { UserRole } from '../api/types';

/**
 * Offers all 3 roles at self-registration on purpose, matching the
 * backend's own documented Phase 15 design decision
 * (backend/src/services/auth.service.ts's `register()`): there is no
 * invite/promotion flow in this project's scope, so this is the only way
 * to reach OPERATOR/ADMIN behavior at all (e.g. to create an incident, or
 * to explore this demo without seeding). A production deployment would
 * need a real invite flow before exposing this choice to an
 * unauthenticated caller -- this is a demo/dev-mode convenience, not a
 * pattern to copy into a real product.
 */
export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('USER');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);
    try {
      await register(email, password, role);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed.');
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
        <p className="text-secondary auth-subtitle">Create an account to explore the platform.</p>

        <form onSubmit={handleSubmit} className="stack" style={{ gap: 'var(--space-4)', marginTop: 'var(--space-6)' }}>
          <div className="field">
            <label className="field__label" htmlFor="register-email">
              Email
            </label>
            <input
              id="register-email"
              className="input"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="register-password">
              Password (min. 8 characters)
            </label>
            <input
              id="register-password"
              className="input"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="register-role">
              Role
            </label>
            <select id="register-role" className="select" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              <option value="USER">USER</option>
              <option value="OPERATOR">OPERATOR</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>
          {error && (
            <div role="alert" className="form-error">
              {error}
            </div>
          )}
          <Button type="submit" variant="primary" disabled={submitting} style={{ width: '100%' }}>
            {submitting ? 'Registering…' : 'Register'}
          </Button>
        </form>

        <p className="auth-footer text-secondary">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}
