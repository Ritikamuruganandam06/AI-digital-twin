/**
 * Barrel export for the deterministic simulation engine (docs/phases.md
 * Phase 7). A future phase's tool layer (docs/architecture.md §10 — the
 * internal HTTP endpoints the AI service calls) imports every scenario
 * function from this one module rather than reaching into individual
 * files.
 */
export * from './types';
export * from './constants';
export { bfsClosure, cascadeFromOrigins, type GraphEdgeEntry } from './graph';
export { calculateBlastRadius } from './blastRadius';
export { findBottleneck, type BottleneckRanking, type BottleneckResult } from './bottleneck';
export { simulateServiceFailure } from './serviceFailure';
export { simulateTrafficIncrease } from './trafficIncrease';
export { simulateDatabaseFailure } from './databaseFailure';
export { simulateCacheFailure } from './cacheFailure';
export { simulateHighLatency } from './highLatency';
export { simulateHighErrorRate } from './highErrorRate';
