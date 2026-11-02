import { randomUUID } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppError } from './errors';
import type { Config } from './config';
import type { Clinic, Conversation, Document, Message, Slot, Usage } from './domain';
import { CLINIC_ID, CLINIC_NAME, makeSlots, mockEmbedding } from './demo-data';

export interface Repository {
  clinic(id: string): Promise<Clinic>;
  conversation(clinicId: string, id?: string): Promise<Conversation>;
  acquire(id: string, clinicId: string, lease: string): Promise<void>;
  release(id: string, clinicId: string, lease: string): Promise<void>;
  updateConversation(id: string, clinicId: string, patch: Partial<Pick<Conversation, 'pending_booking' | 'status' | 'handoff_reason'>>): Promise<void>;
  messages(conversationId: string): Promise<Message[]>;
  addMessage(conversationId: string, role: Message['role'], content: string): Promise<void>;
  search(clinicId: string, embedding: number[], query?: string): Promise<Document[]>;
  slots(clinicId: string, from: string, to: string): Promise<Slot[]>;
  logUsage(usage: Usage): Promise<void>;
}
export function unwrap<T>(result: { data: unknown; error: { code?: string; message: string } | null }): T {
  if (result.error) {
    if (['P0001', '23505'].includes(result.error.code ?? '')) throw new AppError(409, 'BOOKING_CONFLICT', 'That appointment is no longer available. Please choose another time.');
    throw new AppError(503, 'DATABASE_UNAVAILABLE', 'The clinic service is temporarily unavailable.');
  }
  return result.data as T;
}
export class SupabaseRepository implements Repository {
  constructor(public readonly db: SupabaseClient) {}
  async clinic(id: string) {
    const row = unwrap<Clinic | null>(await this.db.from('clinics').select('*').eq('id', id).maybeSingle());
    if (!row) throw new AppError(404, 'CLINIC_NOT_FOUND', 'Clinic not found');
    return row;
  }
  async conversation(clinicId: string, id?: string) {
    if (!id) return unwrap<Conversation>(await this.db.from('conversations').insert({ clinic_id: clinicId }).select('*').single());
    const row = unwrap<Conversation | null>(await this.db.from('conversations').select('*').eq('id', id).eq('clinic_id', clinicId).maybeSingle());
    if (!row) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    return row;
  }
  async acquire(id: string, clinicId: string, lease: string) {
    const rows = unwrap<Conversation[]>(await this.db.rpc('acquire_conversation', { p_id: id, p_clinic_id: clinicId, p_lease: lease }));
    if (!rows.length) throw new AppError(409, 'CONVERSATION_BUSY', 'Please wait for the previous reply.');
  }
  async release(id: string, clinicId: string, lease: string) {
    unwrap(await this.db.from('conversations').update({ lease_id: null, locked_until: null }).eq('id', id).eq('clinic_id', clinicId).eq('lease_id', lease));
  }
  async updateConversation(id: string, clinicId: string, patch: Partial<Pick<Conversation, 'pending_booking' | 'status' | 'handoff_reason'>>) {
    unwrap(await this.db.from('conversations').update(patch).eq('id', id).eq('clinic_id', clinicId));
  }
  async messages(id: string) { return unwrap<Message[]>(await this.db.from('messages').select('*').eq('conversation_id', id).order('created_at', { ascending: false }).limit(30)).reverse(); }
  async addMessage(id: string, role: Message['role'], content: string) { unwrap(await this.db.from('messages').insert({ conversation_id: id, role, content })); }
  async search(clinicId: string, embedding: number[]) {
    return unwrap<Document[]>(await this.db.rpc('match_documents', { query_embedding: embedding, clinic_id: clinicId, match_count: 4 }));
  }
  async slots(clinicId: string, from: string, to: string) {
    return unwrap<Slot[]>(await this.db.from('slots').select('*').eq('clinic_id', clinicId).eq('is_booked', false).gte('starts_at', from).lte('starts_at', to).order('starts_at').limit(6));
  }
  async logUsage(usage: Usage) { unwrap(await this.db.from('llm_usage').insert(usage)); }
}
export class MemoryRepository implements Repository {
  clinics: Clinic[] = [{ id: CLINIC_ID, name: CLINIC_NAME, timezone: 'Asia/Karachi' }];
  documents: Document[];
  slotRows = makeSlots().filter(s => new Date(s.starts_at).getUTCDay() !== 0);
  conversationRows: Conversation[] = [];
  messageRows: Message[] = [];
  usageRows: Usage[] = [];
  private locks = new Map<string, { lease: string; expires: number }>();
  constructor() {
    const folder = resolve(__dirname, '../seed/documents');
    this.documents = readdirSync(folder).filter(n => n.endsWith('.md')).map(file => {
      const [heading, ...rest] = readFileSync(resolve(folder, file), 'utf8').split('\n');
      const title = heading.replace(/^# /, '');
      const content = rest.join('\n').trim();
      return { id: randomUUID(), clinic_id: CLINIC_ID, title, content, embedding: mockEmbedding(`${title} `.repeat(4) + content) };
    });
  }
  async clinic(id: string) {
    const row = this.clinics.find(c => c.id === id);
    if (!row) throw new AppError(404, 'CLINIC_NOT_FOUND', 'Clinic not found');
    return row;
  }
  async conversation(clinicId: string, id?: string) {
    if (id) {
      const row = this.conversationRows.find(c => c.id === id && c.clinic_id === clinicId);
      if (!row) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
      return row;
    }
    const row: Conversation = { id: randomUUID(), clinic_id: clinicId, status: 'active', handoff_reason: null, pending_booking: null, created_at: new Date().toISOString() };
    this.conversationRows.push(row);
    return row;
  }
  async acquire(id: string, clinicId: string, lease: string) {
    await this.conversation(clinicId, id);
    if ((this.locks.get(id)?.expires ?? 0) > Date.now()) throw new AppError(409, 'CONVERSATION_BUSY', 'Please wait for the previous reply.');
    this.locks.set(id, { lease, expires: Date.now() + 300_000 });
  }
  async release(id: string, _clinicId: string, lease: string) { if (this.locks.get(id)?.lease === lease) this.locks.delete(id); }
  async updateConversation(id: string, clinicId: string, patch: Partial<Conversation>) { Object.assign(await this.conversation(clinicId, id), patch); }
  async messages(id: string) { return this.messageRows.filter(m => m.conversation_id === id).slice(-30); }
  async addMessage(id: string, role: Message['role'], content: string) { this.messageRows.push({ id: randomUUID(), conversation_id: id, role, content, created_at: new Date().toISOString() }); }
  async search(clinicId: string, embedding: number[], query?: string) {
    const terms = (query?.toLowerCase().match(/[a-z]+/g) ?? []).filter(t => t.length > 2 && !['what','are','the','your','can','you','tell','about'].includes(t));
    return this.documents.filter(d => d.clinic_id === clinicId && (!query || terms.some(t => (`${d.title} ${d.content}`).toLowerCase().split(/[^a-z]+/).includes(t)))).map(d => ({ ...d, embedding: undefined, similarity: d.embedding!.reduce((sum, n, i) => sum + n * embedding[i], 0) }))
      .filter(d => d.similarity > 0.15).sort((a, b) => b.similarity - a.similarity).slice(0, 4);
  }
  async slots(clinicId: string, from: string, to: string) { return this.slotRows.filter(s => s.clinic_id === clinicId && !s.is_booked && s.starts_at >= from && s.starts_at <= to).sort((a,b) => a.starts_at.localeCompare(b.starts_at)).slice(0, 6); }
  async logUsage(usage: Usage) { this.usageRows.push({ ...usage, id: randomUUID(), created_at: new Date().toISOString() }); }
}
export function createRepository(config: Config): Repository {
  if (config.DEMO_MODE) return new MemoryRepository();
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Set Supabase credentials or use local DEMO_MODE=true');
  return new SupabaseRepository(createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }));
}
