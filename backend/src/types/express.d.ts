// Augments Express's Request type with the fields our middleware attaches.
// Kept in its own file so it's obvious this is a global ambient declaration,
// not a module to import from.
import 'express';
import type { UserRole } from '../utils/jwt';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id for this request — set by src/middleware/requestId.ts */
      id: string;
      /**
       * Set by src/middleware/authenticate.ts once a valid JWT is presented.
       * Absent on routes mounted without that middleware (e.g. /api/auth,
       * /internal/tools) and on any request that never reached it.
       */
      user?: {
        id: string;
        email: string;
        role: UserRole;
      };
    }
  }
}

export {};
