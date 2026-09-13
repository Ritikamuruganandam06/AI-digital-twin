import { RequestHandler } from 'express';
import { assertDatabaseConnected } from '../config/database';
import { serviceRepository } from '../repositories/service.repository';
import { serviceMetricRepository } from '../repositories/serviceMetric.repository';
import { eventRepository } from '../repositories/event.repository';
import { incidentRepository, type IncidentStatus } from '../repositories/incident.repository';
import { getServiceTopology, listServices } from '../services/topology.service';
import { createIncident } from '../services/incident.service';
import { recommendScalingForService } from '../services/recommendation.service';
import { AppError } from '../utils/AppError';

/**
 * docs/architecture.md §10's "Read-only" and "Privileged actions" tool
 * groups, plus get_current_system_state. Every handler here is a thin
 * wrapper around Phase 6 business logic already exercised by
 * services.controller.ts/events.controller.ts/incidents.controller.ts —
 * this file adds no new domain behavior for those tools, only a second,
 * tool-shaped entry point at /internal/tools/* (docs/architecture.md §4:
 * "Internal HTTP endpoints the AI service calls as tools"), separate from
 * the public /api/* surface a browser/frontend would use. The simulation
 * tools live in simulationTools.controller.ts; this file does not.
 *
 * None of these routes are cached (unlike GET /api/services) — tool calls
 * are agent-driven, not high-volume public traffic, and always-fresh data
 * is more valuable than a 30s-stale cache when an LLM is actively
 * investigating a live incident.
 */

// ---- Read-only tools -------------------------------------------------

/** get_services */
export const getServicesToolHandler: RequestHandler = async (_req, res, next) => {
  try {
    assertDatabaseConnected();
    const services = await listServices();
    res.status(200).json({ data: services });
  } catch (err) {
    next(err);
  }
};

/** get_service */
export const getServiceToolHandler: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();
    const name = String(req.params.name ?? '').toLowerCase().trim();
    const topology = await getServiceTopology(name);
    if (!topology) {
      throw new AppError(`Service "${name}" not found`, 404);
    }
    res.status(200).json({ data: topology });
  } catch (err) {
    next(err);
  }
};

/** get_dependencies */
export const getDependenciesToolHandler: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();
    const name = String(req.params.name ?? '').toLowerCase().trim();
    const topology = await getServiceTopology(name);
    if (!topology) {
      throw new AppError(`Service "${name}" not found`, 404);
    }
    res.status(200).json({ data: topology.resolvedDependencies });
  } catch (err) {
    next(err);
  }
};

/** get_dependents */
export const getDependentsToolHandler: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();
    const name = String(req.params.name ?? '').toLowerCase().trim();
    const topology = await getServiceTopology(name);
    if (!topology) {
      throw new AppError(`Service "${name}" not found`, 404);
    }
    res.status(200).json({ data: topology.resolvedDependents });
  } catch (err) {
    next(err);
  }
};

/** get_service_metrics */
export const getServiceMetricsToolHandler: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();
    const name = String(req.params.name ?? '').toLowerCase().trim();
    const requested = Number(req.query.limit ?? 20);
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 200) : 20;

    const service = await serviceRepository.findByName(name);
    if (!service) {
      throw new AppError(`Service "${name}" not found`, 404);
    }

    const metrics = await serviceMetricRepository.findRecentByServiceId(service.id, limit);
    res.status(200).json({ data: metrics });
  } catch (err) {
    next(err);
  }
};

/** get_recent_events */
export const getRecentEventsToolHandler: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();
    const requested = Number(req.query.limit ?? 20);
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 200) : 20;

    let serviceId: string | undefined;
    if (typeof req.query.service === 'string' && req.query.service.trim().length > 0) {
      const service = await serviceRepository.findByName(req.query.service);
      if (!service) {
        throw new AppError(`Service "${req.query.service}" not found`, 404);
      }
      serviceId = service.id;
    }

    const events = await eventRepository.findRecent(limit, serviceId);
    res.status(200).json({ data: events });
  } catch (err) {
    next(err);
  }
};

const VALID_INCIDENT_STATUSES: IncidentStatus[] = ['open', 'investigating', 'resolved'];

/** get_incident_history */
export const getIncidentHistoryToolHandler: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();
    const requested = Number(req.query.limit ?? 20);
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 100) : 20;

    let status: IncidentStatus | undefined;
    if (typeof req.query.status === 'string' && req.query.status.length > 0) {
      if (!VALID_INCIDENT_STATUSES.includes(req.query.status as IncidentStatus)) {
        throw new AppError(`status must be one of: ${VALID_INCIDENT_STATUSES.join(', ')}`, 400);
      }
      status = req.query.status as IncidentStatus;
    }

    const incidents = await incidentRepository.findAll(status, limit);
    res.status(200).json({ data: incidents });
  } catch (err) {
    next(err);
  }
};

/** get_current_system_state — a summary view no other endpoint provides: every service plus a status-count rollup. */
export const getCurrentSystemStateToolHandler: RequestHandler = async (_req, res, next) => {
  try {
    assertDatabaseConnected();
    const services = await listServices();

    const byStatus = { healthy: 0, degraded: 0, down: 0 };
    for (const service of services) {
      byStatus[service.health.status] += 1;
    }

    res.status(200).json({
      data: {
        totalServices: services.length,
        byStatus,
        services,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---- Privileged tools --------------------------------------------------

/**
 * recommend_scaling — "returns a recommendation, does not act" (§10), so
 * unlike create_incident below, this is safe to execute for real every
 * time the agent calls it; nothing is mutated.
 */
export const recommendScalingToolHandler: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();
    const name = String(req.params.name ?? '').toLowerCase().trim();
    const recommendation = await recommendScalingForService(name);
    if (!recommendation) {
      throw new AppError(`Service "${name}" not found`, 404);
    }
    res.status(200).json({ data: recommendation });
  } catch (err) {
    next(err);
  }
};

const VALID_INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

/**
 * create_incident — mutates real state. §10: "Privileged actions require
 * explicit user/operator approval before execution; the agent can
 * *propose* one but cannot silently execute it." This backend endpoint
 * performs the real write when called — Phase 15 (JWT/RBAC) is what will
 * add a real approval gate at this layer. Until then, the enforcement
 * that the AGENT can't silently execute this lives in the AI service's
 * tool executor (ai-service/app/tools/executor.py), which intercepts
 * create_incident and never calls this endpoint from inside the
 * autonomous loop — it returns a proposal instead. This endpoint stays as
 * permissive as the existing public POST /api/incidents (no auth exists
 * anywhere in the app yet), so a future authorized caller (an operator
 * clicking "approve" in Phase 17's UI) has a real endpoint to call.
 */
export const createIncidentToolHandler: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();

    const { title, description, serviceName, affectedServiceNames, severity } = req.body ?? {};

    if (typeof title !== 'string' || title.trim().length === 0) {
      throw new AppError('title is required and must be a non-empty string', 400);
    }
    if (typeof description !== 'string' || description.trim().length === 0) {
      throw new AppError('description is required and must be a non-empty string', 400);
    }
    if (typeof serviceName !== 'string' || serviceName.trim().length === 0) {
      throw new AppError('serviceName is required and must be a non-empty string', 400);
    }
    if (
      typeof severity !== 'string' ||
      !VALID_INCIDENT_SEVERITIES.includes(severity as (typeof VALID_INCIDENT_SEVERITIES)[number])
    ) {
      throw new AppError(`severity is required and must be one of: ${VALID_INCIDENT_SEVERITIES.join(', ')}`, 400);
    }
    if (affectedServiceNames !== undefined) {
      if (!Array.isArray(affectedServiceNames) || affectedServiceNames.some((n) => typeof n !== 'string')) {
        throw new AppError('affectedServiceNames must be an array of strings when provided', 400);
      }
    }

    const incident = await createIncident({
      title: title.trim(),
      description: description.trim(),
      serviceName: serviceName.trim(),
      affectedServiceNames,
      severity: severity as (typeof VALID_INCIDENT_SEVERITIES)[number],
    });

    res.status(201).json({ data: incident });
  } catch (err) {
    next(err);
  }
};
