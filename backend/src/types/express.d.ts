// Augments Express's Request type with the fields our middleware attaches.
// Kept in its own file so it's obvious this is a global ambient declaration,
// not a module to import from.
import 'express';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id for this request — set by src/middleware/requestId.ts */
      id: string;
    }
  }
}

export {};
