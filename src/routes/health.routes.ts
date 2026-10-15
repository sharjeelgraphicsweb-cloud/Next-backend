import { Router } from 'express';
import mongoose from 'mongoose';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: 'mongodb',
    message: 'Backend API is running with MongoDB',
  });
});

router.get('/ready', (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  return res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'unavailable',
    database: ready ? 'mongodb' : 'disconnected',
  });
});

export default router;
