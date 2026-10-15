import mongoose from 'mongoose';
import { env } from './env';

let connectionPromise: Promise<typeof mongoose> | undefined;

export class MissingMongoUriError extends Error {
  constructor() {
    super('MONGODB_URI must be configured before starting backend2.');
    this.name = 'MissingMongoUriError';
  }
}

export async function connectDatabase(): Promise<void> {
  if (!env.MONGODB_URI) {
    throw new MissingMongoUriError();
  }

  if (mongoose.connection.readyState === 1) return;

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(env.MONGODB_URI, {
      dbName: env.DB_DATABASE || undefined,
      // Serverless cold starts need a slightly longer window than a local
      // always-on server; keep it safely below the default 10s Vercel limit.
      serverSelectionTimeoutMS: 8000,
    });
  }

  try {
    await connectionPromise;
  } catch (error) {
    connectionPromise = undefined;
    throw error;
  }

  // Serverless runtimes freeze instances between requests and the Mongo driver
  // may drop idle connections. A resolved promise does not mean the socket is
  // usable, so verify the live readyState before serving the request. If the
  // connection died, reset the cached promise so the next request reconnects.
  if ((mongoose.connection.readyState as unknown as number) !== 1) {
    connectionPromise = undefined;
    throw new Error('MongoDB connection was not established.');
  }
}

export function getDatabase() {
  const database = mongoose.connection.db;
  if (!database) {
    throw new Error('MongoDB is not connected.');
  }
  return database;
}
