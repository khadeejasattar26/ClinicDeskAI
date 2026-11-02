import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { loadConfig, type Config } from './config';
import { errorHandler } from './errors';

export function createApp(config: Config = loadConfig()) {
  const app = express();
  app.disable('x-powered-by');
  if (config.TRUST_PROXY_HOPS) app.set('trust proxy', config.TRUST_PROXY_HOPS);
  app.use(helmet(), cors({ origin: config.WEB_ORIGIN }), express.json({ limit: '16kb' }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'clinicdesk-ai' }));
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }));
  app.use(errorHandler);
  return app;
}
