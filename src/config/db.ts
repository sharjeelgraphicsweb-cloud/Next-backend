import mongoose from 'mongoose';
import { env } from './env';

export async function connectDatabase(): Promise<void> {
  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI must be configured before starting backend2.');
  }

  await mongoose.connect(env.MONGODB_URI, {
    dbName: env.DB_DATABASE || undefined,
    serverSelectionTimeoutMS: 5000,
  });

  console.log('MongoDB connection established.');
}

export function getDatabase() {
  const database = mongoose.connection.db;
  if (!database) {
    throw new Error('MongoDB is not connected.');
  }
  return database;
}
