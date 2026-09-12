import { randomUUID } from 'crypto';
import { RequestHandler } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Assigns a correlation id to every request: reuses one supplied by the
 * caller (e.g. the frontend forwarding an id it generated, or another
 * internal service) so a single operation stays traceable across process
 * boundaries, or mints a new one otherwise. Echoed back as a response
 * header so a client can log it against what it saw.
 *
 * This is what request/correlation-id logging (docs/architecture.md §21)
 * is built on, and what agent execution traces (Phase 14) will thread
 * through to the AI service.
 */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header(REQUEST_ID_HEADER);
  const id = incoming && incoming.trim().length > 0 ? incoming.trim() : randomUUID();

  req.id = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
};
