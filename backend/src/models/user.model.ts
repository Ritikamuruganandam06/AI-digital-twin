import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';


const userSchema = new Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['USER', 'OPERATOR', 'ADMIN'], required: true, default: 'USER' },
  },
  { timestamps: true }
);

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<UserAttrs>;

export const User = model<UserAttrs>('User', userSchema, 'users');
