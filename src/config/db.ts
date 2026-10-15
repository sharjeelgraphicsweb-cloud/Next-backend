import mongoose from 'mongoose';
import { env } from './env';

let connectionPromise: Promise<typeof mongoose> | undefined;

export async function connectDatabase(): Promise<void> {
  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI must be configured before starting backend2.');
  }

  if (mongoose.connection.readyState === 1) return;

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(env.MONGODB_URI, {
      dbName: env.DB_DATABASE || undefined,
      serverSelectionTimeoutMS: 5000,
    });
  }

  try {
    await connectionPromise;
  } catch (error) {
    connectionPromise = undefined;
    throw error;
  }
}

export function getDatabase() {
  const database = mongoose.connection.db;
  if (!database) {
    throw new Error('MongoDB is not connected.');
  }
  return database;
}
