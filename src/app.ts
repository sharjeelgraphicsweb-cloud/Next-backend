import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { rateLimit } from 'express-rate-limit';
import { env } from './config/env';
import { requireAdmin, requireAuth } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import adminRoutes from './routes/admin.routes';
import authRoutes from './routes/auth.routes';
import certificatesRoutes from './routes/certificates.routes';
import courseRoutes from './routes/courses.routes';
import gamificationRoutes from './routes/gamification.routes';
import healthRoutes from './routes/health.routes';
import profileRoutes from './routes/profile.routes';
import progressRoutes from './routes/progress.routes';
import quizRoutes from './routes/quiz.routes';
import resumeRoutes from './routes/resumes.routes';
import roadmapRoutes from './routes/roadmaps.routes';
import skillGapRoutes from './routes/skill-gap.routes';
import { uploadDirectory } from './middleware/uploads';

const app = express();
if (env.NODE_ENV === 'production') app.set('trust proxy', 1);

app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'Backend API is running',
  });
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

app.use(
  cors({
    origin(origin, callback) {
      // Reflect the configured frontend only for matching browser origins.
      // Non-browser requests (no Origin) are allowed without an ACAO header.
      if (!origin || origin === env.CORS_ORIGIN) {
        return callback(null, env.CORS_ORIGIN);
      }
      return callback(null, false);
    },
    credentials: true,
    preflightContinue: true,
  }),
);
app.options('*', (_req, res) => {
  res.sendStatus(204);
});

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/uploads', express.static(uploadDirectory, { dotfiles: 'deny', index: false, maxAge: '1d' }));

app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);
app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/profile', requireAuth, profileRoutes);
app.use('/api/skill-gap', requireAuth, skillGapRoutes);
app.use('/api/roadmaps', requireAuth, roadmapRoutes);
app.use('/api/resumes', requireAuth, resumeRoutes);
app.use('/api/progress', requireAuth, progressRoutes);
app.use('/api/certificates', certificatesRoutes);
app.use('/api/gamification', requireAuth, gamificationRoutes);
app.use('/api/quiz', requireAuth, quizRoutes);
app.use('/api/admin', requireAuth, requireAdmin, adminRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
