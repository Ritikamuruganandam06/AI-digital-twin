import type { ReactNode } from 'react';
import { Button } from './Button';
import { IconAlertCircle, IconInbox, IconSearchOff } from '../icons';

/**
 * Loading state: an accessible `role="status"` announcement (screen
 * readers, and `AsyncBoundary`'s own test) paired with skeleton bars for
 * sighted users, rather than a spinner -- skeletons communicate roughly
 * where content will land, which a generic spinner doesn't.
 */
export function LoadingState({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" className="stack" style={{ gap: 'var(--space-3)' }}>
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" aria-hidden style={{ height: 46, opacity: 1 - i * 0.15 }} />
      ))}
    </div>
  );
}

/**
 * Error state: `role="alert"` so the real backend-provided message (never
 * a raw stack trace -- `ApiError.message` is always a clean, human
 * string, see `src/api/client.ts`) is announced and shown verbatim, with a
 * retry action wired straight to `useApiQuery`'s `refetch()`.
 */
export function ErrorState({
  title = 'Unable to load this page',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="state-panel state-panel--error">
      <IconAlertCircle size={28} className="state-panel__icon" />
      <div className="state-panel__title">{title}</div>
      <div className="state-panel__body">{message}</div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} style={{ marginTop: 'var(--space-2)' }}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  icon,
  action,
}: {
  title: string;
  body?: ReactNode;
  icon?: 'inbox' | 'search';
  action?: ReactNode;
}) {
  const Icon = icon === 'search' ? IconSearchOff : IconInbox;
  return (
    <div className="state-panel">
      <Icon size={26} className="state-panel__icon" />
      <div className="state-panel__title">{title}</div>
      {body && <div className="state-panel__body">{body}</div>}
      {action}
    </div>
  );
}
