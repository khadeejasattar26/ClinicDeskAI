import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { createServices, type Services } from './services';
import { loadConfig, type Config } from './config';
import { errorHandler } from './errors';

export function createApp(config: Config = loadConfig(), services?: Services) {
  const getServices = () => services ??= createServices(config);
  const app = express();
  app.disable('x-powered-by');
  if (config.TRUST_PROXY_HOPS) app.set('trust proxy', config.TRUST_PROXY_HOPS);
  app.use(helmet(), cors({ origin: config.WEB_ORIGIN }), express.json({ limit: '16kb' }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'clinicdesk-ai' }));
  const chatSchema = z.object({ clinicId: z.string().uuid(), conversationId: z.string().uuid().optional(), message: z.string().trim().min(1).max(2000) }).strict();
  app.post('/api/chat', rateLimit({ windowMs: 60_000, limit: config.CHAT_RATE_LIMIT, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many messages. Please try again in a minute.' } } }), async (req, res, next) => {
    try {
      const body = chatSchema.parse(req.body);
      res.json(await getServices().agent.chat(body.clinicId, body.message, body.conversationId));
    } catch (error) { next(error); }
  });
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }));
  app.use(errorHandler);
  return app;
}
