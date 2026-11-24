import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { getEnv } from './config/env';
import { logger } from './config/logger';
import { healthRouter } from './modules/health/health.routes';
import { authRouter } from './modules/auth/auth.routes';
import { projectsRouter } from './modules/projects/projects.routes';
import { monitorsRouter } from './modules/monitors/monitors.routes';
import { incidentsRouter } from './modules/incidents/incidents.routes';
import { errorHandler, notFoundHandler } from './middleware/error-handler';

export function createApp(): Express {
  const env = getEnv();
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const allowedOrigins = env.CLIENT_ORIGIN.split(',').map((o) => o.trim());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || env.NODE_ENV === 'test') {
          callback(null, true);
          return;
        }
        callback(new Error('Origin not allowed by CORS policy'));
      },
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(cookieParser());

  if (env.NODE_ENV !== 'test') {
    app.use(
      pinoHttp({
        logger,
        autoLogging: {
          ignore: (req) => req.url === '/api/v1/health',
        },
      }),
    );
  }

  app.use('/api/v1', healthRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/projects', projectsRouter);
  app.use('/api/v1/projects/:projectId/monitors', monitorsRouter);
  app.use('/api/v1/projects/:projectId/incidents', incidentsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
