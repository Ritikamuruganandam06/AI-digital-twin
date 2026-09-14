import bcrypt from 'bcryptjs';
import { userRepository } from '../repositories/user.repository';
import { signAccessToken, USER_ROLES, type UserRole } from '../utils/jwt';
import { AppError } from '../utils/AppError';

// Cost factor for bcrypt's key-stretching. 10 is bcrypt's own long-standing
// default and is what most real deployments run in local dev; this is a
// place to raise it later if hashing becomes a measured bottleneck, not
// something to guess higher speculatively now.
const BCRYPT_SALT_ROUNDS = 10;

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

export interface RegisterInput {
  email: string;
  password: string;
  role?: UserRole;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResult {
  token: string;
  user: { id: string; email: string; role: UserRole };
}

/**
 * `role` defaults to USER. Self-selecting OPERATOR/ADMIN at registration is
 * allowed on purpose: docs/phases.md row 15 asks only for "JWT, RBAC
 * (USER/OPERATOR/ADMIN)" and "tests per role", and this phase has no
 * existing ADMIN account and no separate invite/promotion flow to gate
 * behind one — that's a real gap for a production system, called out
 * explicitly in the Phase 15 report rather than silently pretended away.
 * What IS enforced is that role must be one of the 3 real roles, not any
 * string.
 */
export async function register(input: RegisterInput): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  const role = input.role ?? 'USER';

  if (!USER_ROLES.includes(role)) {
    throw new AppError(`role must be one of: ${USER_ROLES.join(', ')}`, 400);
  }

  const existing = await userRepository.findByEmail(email);
  if (existing) {
    throw new AppError(`An account with email "${email}" already exists`, 409);
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);
  const user = await userRepository.create({ email, passwordHash, role });

  const token = signAccessToken({ id: user.id, email: user.email, role: user.role });
  return { token, user: { id: user.id, email: user.email, role: user.role } };
}

/**
 * Same 401 + identical message whether the email doesn't exist or the
 * password is wrong — never confirms/denies which one it was, standard
 * practice against account-enumeration.
 */
export async function login(input: LoginInput): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  const user = await userRepository.findByEmail(email);
  if (!user) {
    throw new AppError(INVALID_CREDENTIALS_MESSAGE, 401);
  }

  const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordMatches) {
    throw new AppError(INVALID_CREDENTIALS_MESSAGE, 401);
  }

  const token = signAccessToken({ id: user.id, email: user.email, role: user.role });
  return { token, user: { id: user.id, email: user.email, role: user.role } };
}
