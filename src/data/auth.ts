import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';
import { collection, mongoId } from './mongo';
import { UserRole } from '../types';

export interface StoredUser {
  _id: ObjectId | string;
  name: string;
  email: string;
  password: string;
  role?: UserRole;
  avatar?: string | null;
  domain?: string | null;
  skills?: string[];
  location?: { lat: number; lng: number } | null;
  google_id?: string | null;
  created_at?: Date | string;
  updated_at?: Date | string;
  [key: string]: unknown;
}

export interface StoredToken {
  _id: ObjectId | string;
  token: string;
  tokenable_id: string | ObjectId;
  tokenable_type: string;
  abilities?: string[];
  expires_at?: Date | null;
}

export function userIdString(id: ObjectId | string): string {
  return id.toString();
}

export function userPayload(user: StoredUser) {
  return {
    id: userIdString(user._id),
    name: user.name,
    email: user.email,
    role: user.role || 'user',
    avatar: user.avatar ?? null,
  };
}

export async function findUserByEmail(email: string): Promise<StoredUser | null> {
  return collection<StoredUser>('users').findOne({ email });
}

export async function verifyLaravelPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, storedHash.replace(/^\$2y\$/, '$2b$'));
  } catch {
    return false;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
  return bcrypt.hash(password, Math.min(Math.max(rounds, 10), 14));
}

export async function issueSanctumToken(user: StoredUser): Promise<string> {
  const id = new ObjectId();
  const secret = randomBytes(32).toString('hex');
  const now = new Date();

  await collection<StoredToken>('personal_access_tokens').insertOne({
    _id: id,
    name: 'access_token',
    token: createHash('sha256').update(secret).digest('hex'),
    abilities: ['*'],
    tokenable_id: userIdString(user._id),
    tokenable_type: 'App\\Models\\User',
    last_used_at: now,
    expires_at: null,
    created_at: now,
    updated_at: now,
  } as StoredToken);

  return `${id.toString()}|${secret}`;
}

export async function resolveSanctumToken(rawToken: string): Promise<{ user: StoredUser; tokenId: string } | null> {
  const separator = rawToken.indexOf('|');
  let tokenRecord: StoredToken | null = null;
  let secret = rawToken;

  if (separator > 0) {
    const tokenId = rawToken.slice(0, separator);
    secret = rawToken.slice(separator + 1);
    if (!ObjectId.isValid(tokenId)) return null;
    tokenRecord = await collection<StoredToken>('personal_access_tokens').findOne({ _id: new ObjectId(tokenId) });
  } else {
    tokenRecord = await collection<StoredToken>('personal_access_tokens').findOne({
      token: createHash('sha256').update(secret).digest('hex'),
    });
  }

  if (!tokenRecord || !safeHashMatch(tokenRecord.token, secret)) return null;
  if (tokenRecord.expires_at && new Date(tokenRecord.expires_at) <= new Date()) return null;

  const user = await collection<StoredUser>('users').findOne({
    _id: mongoId(String(tokenRecord.tokenable_id)),
  });
  if (!user) return null;

  await collection<StoredToken>('personal_access_tokens').updateOne(
    { _id: tokenRecord._id },
    { $set: { last_used_at: new Date(), updated_at: new Date() } },
  );

  return { user, tokenId: String(tokenRecord._id) };
}

export async function revokeSanctumToken(tokenId: string): Promise<void> {
  if (!ObjectId.isValid(tokenId)) return;
  await collection<StoredToken>('personal_access_tokens').deleteOne({ _id: new ObjectId(tokenId) });
}

export async function revokeUserTokens(userId: string): Promise<void> {
  await collection<StoredToken>('personal_access_tokens').deleteMany({
    tokenable_type: 'App\\Models\\User',
    $or: [
      { tokenable_id: userId },
      { tokenable_id: mongoId(userId) },
    ],
  });
}

function safeHashMatch(storedHash: string, secret: string): boolean {
  const expected = createHash('sha256').update(secret).digest();
  const actual = Buffer.from(storedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
