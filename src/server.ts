import app from './app';
import { connectDatabase } from './config/db';
import { env } from './config/env';

async function start(): Promise<void> {
  await connectDatabase();

  app.listen(env.PORT, () => {
    console.log(`backend2 is listening on http://localhost:${env.PORT}`);
  });
}

start().catch((error: unknown) => {
  console.error('Failed to start backend2:', error);
  process.exit(1);
});
