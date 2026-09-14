import type { ReactNode } from 'react';
import type { ApiQueryState } from '../api/useApiQuery';
import { ErrorState, LoadingState } from './ui/States';

/**
 * Renders one of three states for a `useApiQuery()` result, so every page
 * gets the same honest "loading / real error / real data" behavior
 * instead of ad hoc `if (loading) return null`-style gaps that silently
 * show a blank page. `state.error` is always a real `ApiError` produced
 * by `api/client.ts` -- never a swallowed exception -- so its `.message`
 * is always safe to show a user directly; there is never a raw stack
 * trace on screen.
 */
export function AsyncBoundary<T>({
  state,
  children,
  errorTitle,
}: {
  state: ApiQueryState<T>;
  children: (data: T) => ReactNode;
  /** Optional page-specific framing, e.g. "Unable to load services." Falls back to a generic title. */
  errorTitle?: string;
}) {
  if (state.loading && state.data === undefined) {
    return <LoadingState />;
  }

  if (state.error) {
    return <ErrorState title={errorTitle} message={state.error.message} onRetry={state.refetch} />;
  }

  if (state.data === undefined) {
    return null;
  }

  return <>{children(state.data)}</>;
}
