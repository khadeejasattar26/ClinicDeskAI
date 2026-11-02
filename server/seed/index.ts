import { readFile, readdir } from 'fs/promises';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { loadConfig } from '../src/config';
import { CLINIC_ID, CLINIC_NAME, makeSlots, mockEmbedding } from './data';

async function seed() {
  const config = loadConfig();
  if (config.DEMO_MODE) {
    console.log('Demo mode auto-seeds in memory when the API starts. Set DEMO_MODE=false to seed Supabase.');
    return;
  }
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase URL and service role key are required');
  if (!config.MOCK_LLM && !config.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required for live embeddings');
  const email = process.env.SEED_STAFF_EMAIL;
  const password = process.env.SEED_STAFF_PASSWORD;
  if (!email || !password || password.length < 12) throw new Error('Set SEED_STAFF_EMAIL and SEED_STAFF_PASSWORD (12+ characters)');
  const db = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const check = (result: { error: { message: string } | null }) => { if (result.error) throw new Error(result.error.message); };
  check(await db.from('clinics').upsert({ id: CLINIC_ID, name: CLINIC_NAME }));
  const ai = config.MOCK_LLM ? null : new OpenAI({ apiKey: config.OPENAI_API_KEY, timeout: 30_000, maxRetries: 1 });
  const folder = resolve(__dirname, 'documents');
  for (const file of (await readdir(folder)).filter(n => n.endsWith('.md')).sort()) {
    const text = await readFile(resolve(folder, file), 'utf8');
    const [heading, ...lines] = text.split('\n');
    const embedding = ai ? (await ai.embeddings.create({ model: config.OPENAI_EMBEDDING_MODEL, input: text, dimensions: 1536 })).data[0].embedding : mockEmbedding(text);
    check(await db.from('documents').upsert({ clinic_id: CLINIC_ID, title: heading.replace(/^# /, ''), content: lines.join('\n').trim(), embedding }, { onConflict: 'clinic_id,title' }));
  }
  // ignoreDuplicates preserves existing slot IDs and bookings on repeated seed runs.
  check(await db.from('slots').upsert(makeSlots().filter(s => new Date(s.starts_at).getUTCDay() !== 0), { onConflict: 'clinic_id,starts_at', ignoreDuplicates: true }));
  let userId: string | undefined;
  for (let page = 1; !userId; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    userId = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase())?.id;
    if (data.users.length < 100) break;
  }
  if (!userId) {
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    userId = data.user.id;
  }
  check(await db.from('staff_profiles').upsert({ user_id: userId, clinic_id: CLINIC_ID }));
  console.log(`Seeded ${CLINIC_NAME}. Staff: ${email}. Clinic ID: ${CLINIC_ID}`);
}
seed().catch(error => { console.error(error instanceof Error ? error.message : 'Seed failed'); process.exitCode = 1; });
