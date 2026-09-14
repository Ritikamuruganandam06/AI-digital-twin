import { Router } from 'express';
import { registerHandler, loginHandler } from '../controllers/auth.controller';

/**
 * Mounted at /api/auth, deliberately outside src/middleware/authenticate.ts
 * — you cannot be required to already hold a JWT in order to obtain one.
 */
export const authRouter = Router();

authRouter.post('/register', registerHandler);
authRouter.post('/login', loginHandler);
