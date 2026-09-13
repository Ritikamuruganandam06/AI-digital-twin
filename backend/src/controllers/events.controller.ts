import { RequestHandler } from 'express';
import { assertDatabaseConnected } from '../config/database';
import { serviceRepository } from '../repositories/service.repository';
import { eventRepository } from '../repositories/event.repository';
import { AppError } from '../utils/AppError';

export const listEventsHandler: RequestHandler = async (req, res, next) => {
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
