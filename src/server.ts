import app from './app';
import { connectDatabase } from './config/db';
import { env } from './config/env';

// Database connection lazmi establish karein
connectDatabase().catch((error: unknown) => {
  console.error('Failed to connect to database:', error);
});

// Sirf Local Development (aapke PC) par app.listen chalega
if (process.env.NODE_ENV !== 'production') {
  const PORT = env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`backend2 is listening on http://localhost:${PORT}`);
  });
}

// Vercel Serverless Functions ke liye app export karna lazmi hai
export default app;