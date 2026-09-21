import bcrypt from 'bcryptjs';
import { userRepository } from '../repositories/user.repository';
import { signAccessToken, USER_ROLES, type UserRole } from '../utils/jwt';
import { AppError } from '../utils/AppError';

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
