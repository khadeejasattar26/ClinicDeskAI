import { randomUUID } from 'crypto';
export const CLINIC_ID = '11111111-1111-4111-8111-111111111111';
export const CLINIC_NAME = 'CareWell Family Clinic, Lahore';
export function makeSlots(now = new Date()) {
  const local = new Date(now.getTime() + 5 * 3600_000);
  const date = local.toISOString().slice(0, 10);
  const base = new Date(`${date}T09:00:00+05:00`).getTime();
  return Array.from({ length: 14 * 16 }, (_, i) => ({
    id: randomUUID(), clinic_id: CLINIC_ID, starts_at: new Date(base + Math.floor(i / 16) * 86400_000 + (i % 16) * 1800_000).toISOString(), is_booked: false
  })).filter(s => new Date(s.starts_at) > now);
}
export function mockEmbedding(text: string): number[] {
  const v = Array<number>(1536).fill(0);
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let hash = 2166136261;
    for (const c of word) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
    v[(hash >>> 0) % v.length] += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map(x => x / norm);
}
