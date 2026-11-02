import express from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { createServices, type Services } from './services';
import { loadConfig, type Config } from './config';
import { AppError, errorHandler } from './errors';

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
  const pagination = z.object({ offset: z.coerce.number().int().nonnegative().default(0), limit: z.coerce.number().int().min(1).max(100).default(50) });
  app.use('/api/admin', async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const match = /^Bearer ([^\s]+)$/.exec(req.get('authorization') ?? '');
      if (!match) throw new AppError(401, 'UNAUTHORIZED', 'Sign in to access the clinic dashboard');
      res.locals.clinicId = await getServices().repo.staffClinic(match[1]);
      next();
    } catch (error) { next(error); }
  });
  for (const resource of ['appointments', 'leads', 'conversations'] as const) {
    app.get(`/api/admin/${resource}`, async (req, res, next) => {
      try {
        const { offset, limit } = pagination.parse(req.query);
        const rows = await getServices().repo.list(res.locals.clinicId, resource, offset, limit + 1);
        res.json({ items: rows.slice(0, limit), hasMore: rows.length > limit, offset });
      } catch (error) { next(error); }
    });
  }
  app.get('/api/admin/conversations/:id', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const { offset, limit } = pagination.parse(req.query);
      const result = await getServices().repo.transcript(res.locals.clinicId, id, offset, limit + 1);
      res.json({ ...result, messages: result.messages.slice(0, limit), hasMore: result.messages.length > limit });
    } catch (error) { next(error); }
  });
  app.get('/api/admin/usage', async (_req, res, next) => {
    try {
      res.json({ ...await getServices().repo.usage(res.locals.clinicId), mock: config.MOCK_LLM, cost_configured: config.MOCK_LLM || (config.OPENAI_INPUT_COST_PER_MILLION > 0 && config.OPENAI_OUTPUT_COST_PER_MILLION > 0 && config.OPENAI_EMBEDDING_COST_PER_MILLION > 0) });
    } catch (error) { next(error); }
  });
  app.post('/api/jobs/send-reminders' , async (req, res, next) => {
    try {
      const secret = req.get('x-cron-secret') ?? '';
      const hash = (value: string) => createHash('sha256').update(value).digest();
      if (!timingSafeEqual(hash(secret), hash(config.CRON_SECRET))) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid job credentials' } });
        return;
      }
      const { repo, emails } = getServices();
      await repo.enqueueReminders();
      res.json(await emails.sendPending());
    } catch (error) { next(error); }
  });
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }));
  app.use(errorHandler);
  return app;
}
