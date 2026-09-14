import { User, type UserDocument } from '../models/user.model';
import type { UserRole } from '../utils/jwt';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  role: UserRole;
}

function toRecord(doc: UserDocument): UserRecord {
  return {
    id: doc._id.toString(),
    email: doc.email,
    passwordHash: doc.passwordHash,
    role: doc.role as UserRole,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Dumb data-access seam over the `users` collection — same division of
 * responsibility incident.repository.ts / agentExecution.repository.ts
 * established: hashing, validation and duplicate-email handling live in
 * src/services/auth.service.ts, not here.
 */
export const userRepository = {
  async create(input: CreateUserInput): Promise<UserRecord> {
    const doc = await User.create(input);
    return toRecord(doc);
  },

  async findByEmail(email: string): Promise<UserRecord | null> {
    const doc = await User.findOne({ email: email.trim().toLowerCase() }).exec();
    return doc ? toRecord(doc) : null;
  },

  async findById(id: string): Promise<UserRecord | null> {
    const doc = await User.findById(id).exec();
    return doc ? toRecord(doc) : null;
  },

  /** Test/seed-only: wipes the collection so a test run/re-seed starts clean. */
  async deleteAll(): Promise<void> {
    await User.deleteMany({});
  },
};
