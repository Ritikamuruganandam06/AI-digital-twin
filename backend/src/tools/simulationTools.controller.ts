import { RequestHandler } from 'express';
import { assertDatabaseConnected } from '../config/database';
import { listServices } from '../services/topology.service';
import {
  calculateBlastRadius,
  findBottleneck,
  simulateServiceFailure,
  simulateTrafficIncrease,
  simulateDatabaseFailure,
  simulateCacheFailure,
  simulateHighLatency,
  simulateHighErrorRate,
} from '../services/simulation';
import { toSimulationServiceStates } from './simulationAdapter';
import { AppError } from '../utils/AppError';

/**
 * docs/architecture.md §10's "Simulation" tool group, wired to real live
 * topology data for the first time — Phase 7 built and unit-tested these
 * 8 functions against hand-built fixtures with zero I/O; this file is the
 * "future phase's tool layer" services/simulation/index.ts's own comment
 * already anticipated: fetch the real topology (listServices()), adapt it
 * (simulationAdapter.ts), and hand it to the unchanged pure engine.
 *
 * All 8 Phase-7 functions are exposed here, not just the 6 §10 names under
 * "Simulation" (simulate_service_failure, simulate_traffic_increase,
 * simulate_database_failure, simulate_cache_failure,
 * calculate_blast_radius, find_bottleneck) — simulate_high_latency and
 * simulate_high_error_rate come from §11's list instead. This is the same
 * §10/§11 discrepancy Phase 7 already resolved by implementing the union
 * of both lists; leaving two already-implemented, already-tested engine
 * functions uncallable here would silently re-introduce that gap at the
 * tool layer Phase 7 explicitly built for.
 *
 * Every engine function throws a plain `Error` (not AppError — the engine
 * is deliberately framework-agnostic) for bad input (unknown service name,
 * non-positive multiplier). Each handler here converts that into a real
 * AppError(400) instead of letting it fall through to the generic 500
 * handler, since these are always caller/LLM input mistakes, not server
 * bugs.
 */

async function loadSimulationTopology() {
  const services = await listServices();
  return toSimulationServiceStates(services);
}

function toBadRequest(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const message = err instanceof Error ? err.message : 'Invalid simulation input';
  return new AppError(message, 400);
}

/** simulate_service_failure */
export const simulateServiceFailureToolHandler: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();
    const { serviceName } = req.body ?? {};
    if (typeof serviceName !== 'string' || serviceName.trim().length === 0) {
      throw new AppError('serviceName is required and must be a non-empty string', 400);
    }

    const topology = await loadSimulationTopology();
    const result = simulateServiceFailure(topology, serviceName.toLowerCase().trim());
    res.status(200).json({ data: result });
  } catch (err) {
    next(toBadRequest(err));
  }
};

/** simulate_traffic_increase */
export const simulateTrafficIncreaseToolHandler: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();
    const { serviceName, multiplier } = req.body ?? {};
    if (typeof serviceName !== 'string' || serviceName.trim().length === 0) {
      throw new AppError('serviceName is required and must be a non-empty string', 400);
    }
    if (typeof multiplier !== 'number' || !Number.isFinite(multiplier)) {
      throw new AppError('multiplier is required and must be a finite number', 400);
    }

    const topology = await loadSimulationTopology();
    const result = simulateTrafficIncrease(topology, serviceName.toLowerCase().trim(), multiplier);
    res.status(200).json({ data: result });
  } catch (err) {
    next(toBadRequest(err));
  }
};

/** simulate_database_failure — whole-system scenario, no target service. */
export const simulateDatabaseFailureToolHandler: RequestHandler = async (_req, res, next) => {
  try {
    assertDatabaseConnected();
    const topology = await loadSimulationTopology();
    const result = simulateDatabaseFailure(topology);
    res.status(200).json({ data: result });
  } catch (err) {
    next(toBadRequest(err));
  }
};

/** simulate_cache_failure — whole-system scenario, no target service. */
export const simulateCacheFailureToolHandler: RequestHandler = async (_req, res, next) => {
  try {
    assertDatabaseConnected();
    const topology = await loadSimulationTopology();
    const result = simulateCacheFailure(topology);
    res.status(200).json({ data: result });
  } catch (err) {
    next(toBadRequest(err));
  }
};

/** simulate_high_latency */
export const simulateHighLatencyToolHandler: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();
    const { serviceName, latencyMultiplier } = req.body ?? {};
    if (typeof serviceName !== 'string' || serviceName.trim().length === 0) {
      throw new AppError('serviceName is required and must be a non-empty string', 400);
    }
    if (typeof latencyMultiplier !== 'number' || !Number.isFinite(latencyMultiplier)) {
      throw new AppError('latencyMultiplier is required and must be a finite number', 400);
    }

    const topology = await loadSimulationTopology();
    const result = simulateHighLatency(topology, serviceName.toLowerCase().trim(), latencyMultiplier);
    res.status(200).json({ data: result });
  } catch (err) {
    next(toBadRequest(err));
  }
};

/** simulate_high_error_rate */
export const simulateHighErrorRateToolHandler: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();
    const { serviceName, errorRateMultiplier } = req.body ?? {};
    if (typeof serviceName !== 'string' || serviceName.trim().length === 0) {
      throw new AppError('serviceName is required and must be a non-empty string', 400);
    }
    if (typeof errorRateMultiplier !== 'number' || !Number.isFinite(errorRateMultiplier)) {
      throw new AppError('errorRateMultiplier is required and must be a finite number', 400);
    }

    const topology = await loadSimulationTopology();
    const result = simulateHighErrorRate(topology, serviceName.toLowerCase().trim(), errorRateMultiplier);
    res.status(200).json({ data: result });
  } catch (err) {
    next(toBadRequest(err));
  }
};

/** calculate_blast_radius */
export const calculateBlastRadiusToolHandler: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();
    const name = String(req.params.name ?? '').toLowerCase().trim();

    const topology = await loadSimulationTopology();
    const result = calculateBlastRadius(topology, name);
    res.status(200).json({ data: result });
  } catch (err) {
    next(toBadRequest(err));
  }
};

/** find_bottleneck — analyzes CURRENT real state, not a hypothetical scenario; takes no target service. */
export const findBottleneckToolHandler: RequestHandler = async (_req, res, next) => {
  try {
    assertDatabaseConnected();
    const topology = await loadSimulationTopology();
    const result = findBottleneck(topology);
    res.status(200).json({ data: result });
  } catch (err) {
    next(toBadRequest(err));
  }
};
