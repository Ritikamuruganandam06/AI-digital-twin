import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './client';

export interface ApiQueryState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  /** Re-runs `fetcher` without a page reload -- used after a mutation (e.g. a new incident) invalidates what a page is showing. */
  refetch: () => void;
  /**
   * `Date.now()` the moment the most recent successful fetch resolved --
   * real client-observed timing, not a value from the backend (the
   * services/health API doesn't return one). `undefined` until the first
   * successful fetch. Lets a page show an honest "Last updated" instead of
   * inventing a polling/monitoring timestamp that doesn't exist.
   */
  lastUpdated: number | undefined;
}

/**
 * The one data-fetching pattern every page in this app needs (fetch on
 * mount, show a loading state, show a typed error, re-fetch on demand),
 * factored out once rather than re-implemented per page. Deliberately
 * small and hand-written rather than a dependency like React Query --
 * this app has no need for caching across components, background
 * refetching, or request deduplication; every page owns exactly one
 * query for exactly as long as it's mounted.
 *
 * `deps` re-runs the fetch when it changes (e.g. a `:name`/`:id` route
 * param), the same role `useEffect`'s own dependency array plays.
 */
export function useApiQuery<T>(fetcher: () => Promise<T>, deps: unknown[]): ApiQueryState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError>();
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number>();
  // Guards against setting state from a stale request that resolves
  // after a newer one already started (e.g. deps changed mid-flight) --
  // without this, a slow first response could overwrite a faster second one.
  const requestIdRef = useRef(0);

  const runFetch = useCallback(() => {
    const thisRequestId = (requestIdRef.current += 1);
    setLoading(true);
    setError(undefined);

    fetcher().then(
      (result) => {
        if (requestIdRef.current !== thisRequestId) return;
        setData(result);
        setLoading(false);
        setLastUpdated(Date.now());
      },
      (err: unknown) => {
        if (requestIdRef.current !== thisRequestId) return;
        setError(err instanceof ApiError ? err : new ApiError(String(err), 0));
        setLoading(false);
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    runFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, refetch: runFetch, lastUpdated };
}
