import request from 'supertest';
import { createApp } from '../src/app';
import { createServices } from '../src/services';
import { loadConfig } from '../src/config';
import { MemoryRepository, SupabaseRepository } from '../src/repository';
import { EmailService } from '../src/email';
import { CLINIC_ID } from '../src/demo-data';
import { createClient } from '@supabase/supabase-js';
const config = loadConfig({ NODE_ENV: 'test', MOCK_LLM: 'true', DEMO_MODE: 'true', CRON_SECRET: 'private-reminder-test-secret' });
async function setup(hours = 24) {
  const services = createServices(config);
  const repo = services.repo as MemoryRepository;
  repo.slotRows[0].starts_at = new Date(Date.now() + hours * 3600_000).toISOString();
  const appointment = await repo.book(CLINIC_ID, { slot_id: repo.slotRows[0].id, patient_name: 'Demo Patient', patient_email: 'demo@example.com', patient_phone: '+923001234567', reason: 'General consultation' });
  const send = jest.fn(async () => {});
  services.emails = new EmailService(repo, { send });
  await services.emails.sendPending(appointment.id);
  send.mockClear();
  const app = createApp(config, services);
  const run = () => request(app).post('/api/jobs/send-reminders').set('x-cron-secret', config.CRON_SECRET);
  return { app, repo, send, appointment, run, services };
}
test('reminders endpoint requires the cron secret', async () => {
  const { app } = await setup();
  expect((await request(app).post('/api/jobs/send-reminders')).status).toBe(401);
  expect((await request(app).post('/api/jobs/send-reminders').set('x-cron-secret', 'wrong')).status).toBe(401);
});
test('24-hour reminder sends once, records timestamp and does not resend', async () => {
  const { run, appointment, send } = await setup();
  expect((await run()).body).toEqual({ sent: 1, failed: 0 });
  expect(appointment.reminder_sent_at).not.toBeNull();
  expect((await run()).body).toEqual({ sent: 0, failed: 0 });
  expect(send).toHaveBeenCalledTimes(1);
});
test('overlapping jobs cannot deliver the same reminder twice', async () => {
  const { run, send } = await setup();
  const results = await Promise.all([run(), run(), run()]);
  expect(results.every(r => r.status === 200)).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
});
test('failed delivery is retried with the same provider idempotency key', async () => {
  const { run, appointment, send } = await setup();
  send.mockRejectedValueOnce(new Error('offline'));
  expect((await run()).body).toEqual({ sent: 0, failed: 1 });
  expect(appointment.reminder_sent_at).toBeNull();
  expect((await run()).body).toEqual({ sent: 1, failed: 0 });
  expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
});
test.each([22, 26])('appointments %i hours away are outside the window', async hours => {
  const { run, send } = await setup(hours);
  expect((await run()).body.sent).toBe(0);
  expect(send).not.toHaveBeenCalled();
});
test('cancelled appointments do not receive reminders', async () => {
  const { run, appointment, send, repo } = await setup();
  await repo.enqueueReminders();
  appointment.status = 'cancelled';
  expect((await run()).body.sent).toBe(0);
  expect(send).not.toHaveBeenCalled();
});
test('claims reject foreign tokens and expired claims can be retried', async () => {
  const { repo } = await setup();
  await repo.enqueueReminders();
  const [email] = await repo.claimEmails('a');
  await repo.finishEmail(email.id, 'b', true);
  expect(email.sent_at).toBeNull();
  expect(await repo.claimEmails('b')).toHaveLength(0);
  email.claimed_at = new Date(Date.now() - 301_000).toISOString();
  expect(await repo.claimEmails('b')).toHaveLength(1);
});
test('Supabase reminder enqueue uses the atomic RPC', async () => {
  const fetcher = jest.fn(async (_url: RequestInfo | URL) => new Response('null', { headers: { 'content-type': 'application/json' } }));
  const repo = new SupabaseRepository(createClient('https://clinic.example.com', 'fake', { global: { fetch: fetcher }, auth: { persistSession: false } }));
  await repo.enqueueReminders();
  expect(String(fetcher.mock.calls[0][0])).toContain('rpc/enqueue_reminders');
});
