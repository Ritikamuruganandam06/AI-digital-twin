export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthCheckResult {
  status: HealthStatus;
  latencyMs?: number;
  message?: string;
}

export type HealthCheckFn = () => Promise<HealthCheckResult>;

/**
 * A registry, not a hardcoded list: Phase 3 (MongoDB), Phase 4 (Redis), and
 * Phase 5 (Kafka) each call registerHealthCheck() from their own module when
 * they wire up their client, and GET /health automatically starts reporting
 * them — src/routes/health.route.ts and src/controllers/health.controller.ts
 * never need to change again as dependencies are added.
 */
const checks = new Map<string, HealthCheckFn>();

export function registerHealthCheck(name: string, check: HealthCheckFn): void {
  checks.set(name, check);
}

/** Test-only: lets each test suite start from a clean registry. */
export function clearHealthChecks(): void {
  checks.clear();
}

export async function runHealthChecks(): Promise<{
  status: HealthStatus;
  checks: Record<string, HealthCheckResult>;
}> {
  const entries = await Promise.all(
    Array.from(checks.entries()).map(async ([name, check]) => {
      try {
        const result = await check();
        return [name, result] as const;
      } catch (err) {
        return [
          name,
          {
            status: 'down' as const,
            message: err instanceof Error ? err.message : 'unknown error',
          },
        ] as const;
      }
    })
  );

  const results = Object.fromEntries(entries) as Record<string, HealthCheckResult>;

  const overall: HealthStatus = entries.some(([, r]) => r.status === 'down')
    ? 'down'
    : entries.some(([, r]) => r.status === 'degraded')
    ? 'degraded'
    : 'ok';

  return { status: overall, checks: results };
}
