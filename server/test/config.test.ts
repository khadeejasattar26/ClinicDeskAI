import { loadConfig } from '../src/config';
import { errorHandler, AppError } from '../src/errors';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';

test('configuration validates ports, secrets and forbids production demo', () => {
  expect(loadConfig({ MOCK_LLM: 'true' }).MOCK_LLM).toBe(true);
  expect(() => loadConfig({ PORT: 'invalid' })).toThrow();
  expect(() => loadConfig({ NODE_ENV: 'production', DEMO_MODE: 'true' })).toThrow('Demo');
  expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow('CRON_SECRET');
  expect(loadConfig({ NODE_ENV: 'production', CRON_SECRET: 'x'.repeat(32) }).NODE_ENV).toBe('production');
});

test.each(['validation', 'known', 'unknown', 'json'])('central errors handle %s', async kind => {
  const app = express();
  app.use(express.json());
  app.post('/', (_req, _res, next) => {
    if (kind === 'validation') { try { z.string().parse(1); } catch (e) { next(e); } }
    else next(kind === 'known' ? new AppError(409, 'CONFLICT', 'Already booked') : new Error('private detail'));
  });
  app.use(errorHandler);
  const res = await request(app).post('/').set('Content-Type', 'application/json').send(kind === 'json' ? '{' : '{}');
  expect(res.status).toBe(kind === 'unknown' ? 500 : kind === 'known' ? 409 : 400);
  expect(res.body.error.code).toBeDefined();
  expect(JSON.stringify(res.body)).not.toContain('private detail');
});
