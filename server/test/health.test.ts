import request from 'supertest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
const app = createApp(loadConfig({ NODE_ENV: 'test', MOCK_LLM: 'true' }));
test('health reports readiness without exposing credentials', async () => {
  const res = await request(app).get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: 'ok', service: 'clinicdesk-ai' });
  expect(res.headers['x-powered-by']).toBeUndefined();
});
test('unknown routes use consistent JSON errors', async () => {
  expect((await request(app).get('/missing')).body.error.code).toBe('NOT_FOUND');
});
