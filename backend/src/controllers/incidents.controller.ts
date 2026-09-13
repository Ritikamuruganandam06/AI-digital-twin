import { RequestHandler } from 'express';
import { Types } from 'mongoose';
import { assertDatabaseConnected } from '../config/database';
import { incidentRepository, type IncidentStatus } from '../repositories/incident.repository';
import { createIncident } from '../services/incident.service';
import { AppError } from '../utils/AppError';

const VALID_STATUSES: IncidentStatus[] = ['open', 'investigating', 'resolved'];
const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export const listIncidentsHandler: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();

    const requested = Number(req.query.limit ?? 20);
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 100) : 20;

    let status: IncidentStatus | undefined;
    if (typeof req.query.status === 'string' && req.query.status.length > 0) {
      if (!VALID_STATUSES.includes(req.query.status as IncidentStatus)) {
        throw new AppError(`status must be one of: ${VALID_STATUSES.join(', ')}`, 400);
      }
      status = req.query.status as IncidentStatus;
    }

    const incidents = await incidentRepository.findAll(status, limit);
    res.status(200).json({ data: incidents });
  } catch (err) {
    next(err);
  }
};

export const getIncidentHandler: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();

    const id = String(req.params.id ?? '');
    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(`"${id}" is not a valid incident id`, 400);
    }

    const incident = await incidentRepository.findById(id);
    if (!incident) {
      throw new AppError(`Incident "${id}" not found`, 404);
    }

    res.status(200).json({ data: incident });
  } catch (err) {
    next(err);
  }
};

export const createIncidentHandler: RequestHandler = async (req, res, next) => {
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
    if (typeof severity !== 'string' || !VALID_SEVERITIES.includes(severity as (typeof VALID_SEVERITIES)[number])) {
      throw new AppError(`severity is required and must be one of: ${VALID_SEVERITIES.join(', ')}`, 400);
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
      severity: severity as (typeof VALID_SEVERITIES)[number],
    });

    res.status(201).json({ data: incident });
  } catch (err) {
    next(err);
  }
};
