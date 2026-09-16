import { randomUUID } from 'crypto';
import { RequestHandler } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header(REQUEST_ID_HEADER);
  const id = incoming && incoming.trim().length > 0 ? incoming.trim() : randomUUID();

  req.id = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
};
