import dotenv from 'dotenv';

dotenv.config();

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: Number(process.env.PORT ?? 8000),
  MONGODB_URI: process.env.MONGODB_URI ?? process.env.DB_URI ?? '',
  DB_DATABASE: process.env.DB_DATABASE ?? '',
  FRONTEND_URL: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  BACKEND_PUBLIC_URL: process.env.BACKEND_PUBLIC_URL ?? 'http://localhost:8000',
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? '',
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY ?? '',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? '',
  GOOGLE_REDIRECT_URL: process.env.GOOGLE_REDIRECT_URL ?? '',
};
