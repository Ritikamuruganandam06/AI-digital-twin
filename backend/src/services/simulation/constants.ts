/**
 * Every deliberately-chosen constant the simulation engine's formulas use,
 * gathered in one place so a reviewer (or a later phase tuning the engine
 * against real traffic patterns) doesn't have to hunt through each scenario
 * file for a magic number. None of these are measured — they're documented,
 * fixed assumptions that make the engine's output deterministic and
 * explainable, not a claim of real capacity-planning accuracy.
 */

/**
 * simulateTrafficIncrease assumes a service's seeded/observed baseline
 * traffic represents this fraction of its real capacity — i.e. baseline
 * traffic already uses 1/3 of what the service can handle before it starts
 * degrading. Chosen so a 2x traffic multiplier pushes a healthy service
 * into "degraded", and a 3x+ multiplier pushes it to "down" (overloaded).
 */
export const TRAFFIC_CAPACITY_MULTIPLIER = 3;

/** Utilization ratio (projected traffic / capacity) above which a service is considered overloaded ("down") rather than merely "degraded". */
export const OVERLOAD_UTILIZATION_RATIO = 1.0;

/** Utilization ratio above which a service starts to visibly degrade (below this, the traffic increase is absorbed without a meaningful impact). */
export const DEGRADED_UTILIZATION_RATIO = 0.7;

/** Each additional hop away from a scenario's origin carries this fraction of the previous hop's effect (latency/error-rate propagation decays with distance). */
export const PROPAGATION_DECAY_FACTOR = 0.5;

/** simulateHighLatency: at or above this multiplier of baseline latency, a service is considered to be timing out ("down") rather than merely slow ("degraded"). */
export const LATENCY_OUTAGE_MULTIPLIER = 5;

/** simulateHighErrorRate: at or above this error rate, a service is considered "down" rather than "degraded". */
export const ERROR_RATE_OUTAGE_PERCENT = 25;

/** simulateCacheFailure: a service that loses its cache gets slower, not broken (mirrors the real getOrSetCache() fallback from Phase 4 — Redis being down means a slower direct fetch, never a failed request). */
export const CACHE_FAILURE_LATENCY_MULTIPLIER = 2.5;

/** simulateCacheFailure: a small, secondary error-rate bump for the directly-affected services — a slower path times out slightly more often, even though it doesn't fail outright. */
export const CACHE_FAILURE_ERROR_RATE_MULTIPLIER = 1.5;
