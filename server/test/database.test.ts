import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { CLINIC_ID, makeSlots, mockEmbedding } from '../seed/data';

let db: PGlite;
const OTHER = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const SLOT = '44444444-4444-4444-8444-444444444444';
beforeAll(async () => {
  db = new PGlite({ extensions: { vector } });
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    grant usage on schema auth to authenticated, service_role;
    grant execute on function auth.uid() to authenticated, service_role;`);
  await db.exec(readFileSync(resolve(__dirname, '../../supabase/migrations/202611020001_clinicdesk.sql'), 'utf8'));
  await db.query('insert into clinics(id,name) values ($1,$2),($3,$4)', [CLINIC_ID, 'CareWell', OTHER, 'Other Clinic']);
  await db.query('insert into auth.users values ($1)', [USER]);
  await db.query('insert into staff_profiles values ($1,$2)', [USER, CLINIC_ID]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [USER]);
  const v = JSON.stringify(mockEmbedding('hours'));
  await db.query('insert into documents(clinic_id,title,content,embedding) values ($1,$2,$3,$4),($5,$2,$6,$4)', [CLINIC_ID, 'Hours', '9 to 5', v, OTHER, 'secret']);
  await db.query("insert into slots(id,clinic_id,starts_at) values ($1,$2,now()+interval '24 hours')", [SLOT, CLINIC_ID]);
}, 30_000);
afterAll(async () => { await db?.close(); });
afterEach(async () => { await db.exec('reset role'); });

test('every application table has RLS enabled', async () => {
  const result = await db.query<{ relname: string; relrowsecurity: boolean }>("select relname,relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='public' and relkind='r'");
  expect(result.rows).toHaveLength(10);
  expect(result.rows.every(t => t.relrowsecurity)).toBe(true);
});
test('staff can only see their clinic and cannot change membership', async () => {
  await db.exec('set role authenticated');
  expect((await db.query('select * from clinics')).rows).toHaveLength(1);
  expect((await db.query<{ content: string }>('select * from documents')).rows.map(d => d.content)).toEqual(['9 to 5']);
  await expect(db.query('insert into documents(clinic_id,title,content,embedding) values ($1,$2,$3,$4)', [OTHER, 'Bad', 'bad', JSON.stringify(mockEmbedding('bad'))])).rejects.toThrow('row-level security');
  await expect(db.query('update staff_profiles set clinic_id=$1', [OTHER])).rejects.toThrow('permission denied');
  await expect(db.query('select book_appointment($1,$2,$3,$4,$5,$6)', [CLINIC_ID, SLOT, 'Patient', 'p@example.com', '03001234567', 'Visit'])).rejects.toThrow('permission denied');
});
test('anonymous roles cannot read patient or clinic data', async () => {
  await db.exec('set role anon');
  await expect(db.query('select * from appointments')).rejects.toThrow('permission denied');
  await expect(db.query('select * from documents')).rejects.toThrow('permission denied');
});
test('vector search respects RLS even when given another clinic ID', async () => {
  await db.exec('set role authenticated');
  expect((await db.query('select * from match_documents($1,$2,4)', [JSON.stringify(mockEmbedding('hours')), CLINIC_ID])).rows).toHaveLength(1);
  expect((await db.query('select * from match_documents($1,$2,4)', [JSON.stringify(mockEmbedding('hours')), OTHER])).rows).toHaveLength(0);
});
test('booking is atomic, scopes slots, prevents duplicates and queues confirmation', async () => {
  await db.exec('set role service_role');
  const args = [CLINIC_ID, SLOT, 'Patient', 'p@example.com', '03001234567', 'General consultation'];
  await expect(db.query('select book_appointment($1,$2,$3,$4,$5,$6)', [OTHER, ...args.slice(1)])).rejects.toThrow('Slot unavailable');
  expect((await db.query('select * from book_appointment($1,$2,$3,$4,$5,$6)', args)).rows).toHaveLength(1);
  await expect(db.query('select book_appointment($1,$2,$3,$4,$5,$6)', args)).rejects.toThrow('Slot unavailable');
  expect((await db.query('select * from appointments')).rows).toHaveLength(1);
  expect((await db.query('select * from email_outbox')).rows).toHaveLength(1);
});
test('reminder outbox claims once and completion is token protected', async () => {
  await db.exec('set role service_role');
  await db.query('select enqueue_reminders()');
  await db.query('select enqueue_reminders()');
  const token = '55555555-5555-4555-8555-555555555555';
  const rows = (await db.query<{ id: string; kind: string }>('select * from claim_emails($1)', [token])).rows;
  expect(rows).toHaveLength(2);
  expect((await db.query('select * from claim_emails($1)', [USER])).rows).toHaveLength(0);
  const reminder = rows.find(r => r.kind === 'reminder')!;
  await db.query('select complete_email($1,$2,true)', [reminder.id, USER]);
  expect((await db.query<{ reminder_sent_at: string | null }>('select reminder_sent_at from appointments')).rows[0].reminder_sent_at).toBeNull();
  await db.query('select complete_email($1,$2,true)', [reminder.id, token]);
  expect((await db.query<{ reminder_sent_at: string | null }>('select reminder_sent_at from appointments')).rows[0].reminder_sent_at).not.toBeNull();
});
test('seed creates normalized deterministic vectors and future half-hour slots', () => {
  const now = new Date('2026-11-02T06:10:00Z');
  const slots = makeSlots(now);
  expect(slots.length).toBeGreaterThan(200);
  expect(slots.every(s => new Date(s.starts_at) > now)).toBe(true);
  expect(new Set(slots.map(s => s.starts_at)).size).toBe(slots.length);
  expect(mockEmbedding('hello')).toEqual(mockEmbedding('hello'));
  expect(mockEmbedding('')).toHaveLength(1536);
  expect(Math.hypot(...mockEmbedding('clinic hours'))).toBeCloseTo(1);
});
