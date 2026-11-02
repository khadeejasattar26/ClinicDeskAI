import { randomUUID } from "crypto";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "./errors";
import type { Config } from "./config";
import type {
  AdminResource,
  UsageSummary,
  Appointment,
  BookingInput,
  Lead,
  LeadInput,
  OutboxEmail,
  Clinic,
  Conversation,
  Document,
  Message,
  Slot,
  Usage,
} from "./domain";
import { CLINIC_ID, CLINIC_NAME, makeSlots, mockEmbedding } from "./demo-data";

export interface Repository {
  staffClinic(token: string): Promise<string>;
  list(
    clinicId: string,
    resource: AdminResource,
    offset: number,
    limit: number,
  ): Promise<Record<string, unknown>[]>;
  transcript(
    clinicId: string,
    id: string,
    offset: number,
    limit: number,
  ): Promise<{ conversation: Conversation; messages: Message[] }>;
  usage(clinicId: string): Promise<UsageSummary>;
  availableSlot(clinicId: string, id: string): Promise<Slot>;
  book(clinicId: string, input: BookingInput): Promise<Appointment>;
  appointment(clinicId: string, id: string): Promise<Appointment>;
  createLead(clinicId: string, input: LeadInput): Promise<Lead>;
  enqueueReminders(): Promise<void>;
  claimEmails(token: string, appointmentId?: string): Promise<OutboxEmail[]>;
  finishEmail(id: string, token: string, success: boolean): Promise<void>;
  clinic(id: string): Promise<Clinic>;
  conversation(clinicId: string, id?: string): Promise<Conversation>;
  acquire(id: string, clinicId: string, lease: string): Promise<Conversation>;
  release(id: string, clinicId: string, lease: string): Promise<void>;
  updateConversation(
    id: string,
    clinicId: string,
    patch: Partial<
      Pick<Conversation, "pending_booking" | "status" | "handoff_reason">
    >,
  ): Promise<void>;
  messages(conversationId: string): Promise<Message[]>;
  addMessage(
    conversationId: string,
    role: Message["role"],
    content: string,
  ): Promise<void>;
  search(
    clinicId: string,
    embedding: number[],
    query?: string,
  ): Promise<Document[]>;
  slots(clinicId: string, from: string, to: string): Promise<Slot[]>;
  logUsage(usage: Usage): Promise<void>;
}
export function unwrap<T>(result: {
  data: unknown;
  error: { code?: string; message: string } | null;
}): T {
  if (result.error) {
    if (["P0001", "23505"].includes(result.error.code ?? ""))
      throw new AppError(
        409,
        "BOOKING_CONFLICT",
        "That appointment is no longer available. Please choose another time.",
      );
    throw new AppError(
      503,
      "DATABASE_UNAVAILABLE",
      "The clinic service is temporarily unavailable.",
    );
  }
  return result.data as T;
}
export class SupabaseRepository implements Repository {
  constructor(public readonly db: SupabaseClient) {}
  async staffClinic(token: string) {
    const { data, error } = await this.db.auth.getUser(token);
    if (error || !data.user?.id)
      throw new AppError(401, "UNAUTHORIZED", "Please sign in again");
    const profile = unwrap<{ clinic_id: string } | null>(
      await this.db
        .from("staff_profiles")
        .select("clinic_id")
        .eq("user_id", data.user.id)
        .maybeSingle(),
    );
    if (!profile)
      throw new AppError(
        403,
        "FORBIDDEN",
        "No clinic access is assigned to this account",
      );
    return profile.clinic_id;
  }
  async list(
    clinicId: string,
    resource: AdminResource,
    offset: number,
    limit: number,
  ) {
    const select =
      resource === "appointments" ? "*,slots!inner(starts_at)" : "*";
    const rows = unwrap<Record<string, unknown>[]>(
      await this.db
        .from(resource)
        .select(select)
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1),
    );
    return rows.map((row) =>
      resource === "appointments"
        ? { ...row, starts_at: (row.slots as { starts_at: string }).starts_at }
        : row,
    );
  }
  async transcript(
    clinicId: string,
    id: string,
    offset: number,
    limit: number,
  ) {
    const conversation = await this.conversation(clinicId, id);
    const messages = unwrap<Message[]>(
      await this.db
        .from("messages")
        .select("*")
        .eq("conversation_id", id)
        .order("created_at")
        .order("id")
        .range(offset, offset + limit - 1),
    );
    return { conversation, messages };
  }
  async usage(clinicId: string) {
    return unwrap<UsageSummary>(
      await this.db.rpc("usage_summary", { p_clinic_id: clinicId }),
    );
  }
  async availableSlot(clinicId: string, id: string) {
    const row = unwrap<Slot | null>(
      await this.db
        .from("slots")
        .select("*")
        .eq("id", id)
        .eq("clinic_id", clinicId)
        .eq("is_booked", false)
        .gt("starts_at", new Date().toISOString())
        .maybeSingle(),
    );
    if (!row)
      throw new AppError(
        409,
        "BOOKING_CONFLICT",
        "That appointment is no longer available.",
      );
    return row;
  }
  async book(clinicId: string, input: BookingInput) {
    const row = unwrap<Appointment>(
      await this.db.rpc("book_appointment", {
        p_clinic_id: clinicId,
        p_slot_id: input.slot_id,
        p_patient_name: input.patient_name,
        p_patient_email: input.patient_email,
        p_patient_phone: input.patient_phone,
        p_reason: input.reason,
      }),
    );
    return this.appointment(clinicId, row.id);
  }
  async appointment(clinicId: string, id: string): Promise<Appointment> {
    const row = unwrap<(Appointment & { slots: { starts_at: string } }) | null>(
      await this.db
        .from("appointments")
        .select("*,slots!inner(starts_at)")
        .eq("id", id)
        .eq("clinic_id", clinicId)
        .maybeSingle(),
    );
    if (!row)
      throw new AppError(404, "APPOINTMENT_NOT_FOUND", "Appointment not found");
    return { ...row, starts_at: row.slots.starts_at };
  }
  async createLead(clinicId: string, input: LeadInput) {
    return unwrap<Lead>(
      await this.db
        .from("leads")
        .insert({ ...input, clinic_id: clinicId })
        .select("*")
        .single(),
    );
  }
  async enqueueReminders() {
    unwrap(await this.db.rpc("enqueue_reminders"));
  }
  async claimEmails(token: string, appointmentId?: string) {
    return unwrap<OutboxEmail[]>(
      await this.db.rpc("claim_emails", {
        p_token: token,
        p_appointment_id: appointmentId ?? null,
      }),
    );
  }
  async finishEmail(id: string, token: string, success: boolean) {
    unwrap(
      await this.db.rpc("complete_email", {
        p_id: id,
        p_token: token,
        p_success: success,
      }),
    );
  }
  async clinic(id: string) {
    const row = unwrap<Clinic | null>(
      await this.db.from("clinics").select("*").eq("id", id).maybeSingle(),
    );
    if (!row) throw new AppError(404, "CLINIC_NOT_FOUND", "Clinic not found");
    return row;
  }
  async conversation(clinicId: string, id?: string) {
    if (!id)
      return unwrap<Conversation>(
        await this.db
          .from("conversations")
          .insert({ clinic_id: clinicId })
          .select("*")
          .single(),
      );
    const row = unwrap<Conversation | null>(
      await this.db
        .from("conversations")
        .select("*")
        .eq("id", id)
        .eq("clinic_id", clinicId)
        .maybeSingle(),
    );
    if (!row)
      throw new AppError(
        404,
        "CONVERSATION_NOT_FOUND",
        "Conversation not found",
      );
    return row;
  }
  async acquire(id: string, clinicId: string, lease: string) {
    const rows = unwrap<Conversation[]>(
      await this.db.rpc("acquire_conversation", {
        p_id: id,
        p_clinic_id: clinicId,
        p_lease: lease,
      }),
    );
    if (!rows.length)
      throw new AppError(
        409,
        "CONVERSATION_BUSY",
        "Please wait for the previous reply.",
      );
    return rows[0];
  }
  async release(id: string, clinicId: string, lease: string) {
    unwrap(
      await this.db
        .from("conversations")
        .update({ lease_id: null, locked_until: null })
        .eq("id", id)
        .eq("clinic_id", clinicId)
        .eq("lease_id", lease),
    );
  }
  async updateConversation(
    id: string,
    clinicId: string,
    patch: Partial<
      Pick<Conversation, "pending_booking" | "status" | "handoff_reason">
    >,
  ) {
    unwrap(
      await this.db
        .from("conversations")
        .update(patch)
        .eq("id", id)
        .eq("clinic_id", clinicId),
    );
  }
  async messages(id: string) {
    return unwrap<Message[]>(
      await this.db
        .from("messages")
        .select("*")
        .eq("conversation_id", id)
        .order("created_at", { ascending: false })
        .limit(30),
    ).reverse();
  }
  async addMessage(id: string, role: Message["role"], content: string) {
    unwrap(
      await this.db
        .from("messages")
        .insert({ conversation_id: id, role, content }),
    );
  }
  async search(clinicId: string, embedding: number[]) {
    return unwrap<Document[]>(
      await this.db.rpc("match_documents", {
        query_embedding: embedding,
        clinic_id: clinicId,
        match_count: 4,
      }),
    );
  }
  async slots(clinicId: string, from: string, to: string) {
    return unwrap<Slot[]>(
      await this.db
        .from("slots")
        .select("*")
        .eq("clinic_id", clinicId)
        .eq("is_booked", false)
        .gte("starts_at", from)
        .lte("starts_at", to)
        .order("starts_at")
        .limit(6),
    );
  }
  async logUsage(usage: Usage) {
    unwrap(await this.db.from("llm_usage").insert(usage));
  }
}
export class MemoryRepository implements Repository {
  clinics: Clinic[] = [
    { id: CLINIC_ID, name: CLINIC_NAME, timezone: "Asia/Karachi" },
  ];
  documents: Document[];
  slotRows = makeSlots().filter((s) => new Date(s.starts_at).getUTCDay() !== 0);
  conversationRows: Conversation[] = [];
  messageRows: Message[] = [];
  usageRows: Usage[] = [];
  appointmentRows: Appointment[] = [];
  leadRows: Lead[] = [];
  emailRows: OutboxEmail[] = [];
  private locks = new Map<string, { lease: string; expires: number }>();
  constructor() {
    const folder = resolve(__dirname, "../seed/documents");
    this.documents = readdirSync(folder)
      .filter((n) => n.endsWith(".md"))
      .map((file) => {
        const [heading, ...rest] = readFileSync(
          resolve(folder, file),
          "utf8",
        ).split("\n");
        const title = heading.replace(/^# /, "");
        const content = rest.join("\n").trim();
        return {
          id: randomUUID(),
          clinic_id: CLINIC_ID,
          title,
          content,
          embedding: mockEmbedding(`${title} `.repeat(4) + content),
        };
      });
  }
  async staffClinic(token: string) {
    if (token !== "local-demo-staff")
      throw new AppError(401, "UNAUTHORIZED", "Please sign in again");
    return CLINIC_ID;
  }
  async list(
    clinicId: string,
    resource: AdminResource,
    offset: number,
    limit: number,
  ) {
    const rows =
      resource === "appointments"
        ? this.appointmentRows
        : resource === "leads"
          ? this.leadRows
          : this.conversationRows;
    return rows
      .filter((row) => row.clinic_id === clinicId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(offset, offset + limit) as unknown as Record<string, unknown>[];
  }
  async transcript(
    clinicId: string,
    id: string,
    offset: number,
    limit: number,
  ) {
    const conversation = await this.conversation(clinicId, id);
    return {
      conversation,
      messages: this.messageRows
        .filter((m) => m.conversation_id === id)
        .slice(offset, offset + limit),
    };
  }
  async usage(clinicId: string): Promise<UsageSummary> {
    const ids = new Set(
      this.conversationRows
        .filter((c) => c.clinic_id === clinicId)
        .map((c) => c.id),
    );
    const rows = this.usageRows.filter((u) => ids.has(u.conversation_id));
    const daily = new Map<string, number>();
    for (const row of rows) {
      if (Date.parse(row.created_at!) < Date.now() - 30 * 86400_000) continue;
      const day = new Date(Date.parse(row.created_at!) + 5 * 3600_000)
        .toISOString()
        .slice(0, 10);
      daily.set(day, (daily.get(day) ?? 0) + 1);
    }
    return {
      total_tokens: rows.reduce(
        (s, u) => s + u.prompt_tokens + u.completion_tokens,
        0,
      ),
      total_cost_usd: rows.reduce((s, u) => s + u.estimated_cost_usd, 0),
      average_latency_ms: rows.length
        ? Math.round(rows.reduce((s, u) => s + u.latency_ms, 0) / rows.length)
        : 0,
      total_calls: rows.length,
      daily: [...daily].sort().map(([day, requests]) => ({ day, requests })),
    };
  }
  async availableSlot(clinicId: string, id: string) {
    const row = this.slotRows.find(
      (s) =>
        s.id === id &&
        s.clinic_id === clinicId &&
        !s.is_booked &&
        Date.parse(s.starts_at) > Date.now(),
    );
    if (!row)
      throw new AppError(
        409,
        "BOOKING_CONFLICT",
        "That appointment is no longer available.",
      );
    return row;
  }
  async book(clinicId: string, input: BookingInput) {
    const slot = this.slotRows.find(
      (s) =>
        s.id === input.slot_id &&
        s.clinic_id === clinicId &&
        !s.is_booked &&
        Date.parse(s.starts_at) > Date.now(),
    );
    if (!slot)
      throw new AppError(
        409,
        "BOOKING_CONFLICT",
        "That appointment is no longer available. Please choose another time.",
      );
    slot.is_booked = true;
    const row: Appointment = {
      ...input,
      id: randomUUID(),
      clinic_id: clinicId,
      starts_at: slot.starts_at,
      status: "confirmed",
      reminder_sent_at: null,
      created_at: new Date().toISOString(),
    };
    this.appointmentRows.push(row);
    this.emailRows.push({
      id: randomUUID(),
      clinic_id: clinicId,
      appointment_id: row.id,
      kind: "confirmation",
      sent_at: null,
      claimed_at: null,
      claim_token: null,
      attempts: 0,
    });
    return row;
  }
  async appointment(clinicId: string, id: string) {
    const row = this.appointmentRows.find(
      (a) => a.id === id && a.clinic_id === clinicId,
    );
    if (!row)
      throw new AppError(404, "APPOINTMENT_NOT_FOUND", "Appointment not found");
    return row;
  }
  async createLead(clinicId: string, input: LeadInput) {
    const row = {
      ...input,
      id: randomUUID(),
      clinic_id: clinicId,
      status: "new",
      created_at: new Date().toISOString(),
    };
    this.leadRows.push(row);
    return row;
  }
  async enqueueReminders() {
    const now = Date.now();
    for (const row of this.appointmentRows) {
      const starts = Date.parse(row.starts_at);
      if (
        row.status !== "confirmed" ||
        row.reminder_sent_at ||
        starts < now + 23 * 3600_000 ||
        starts > now + 25 * 3600_000 ||
        this.emailRows.some(
          (e) => e.appointment_id === row.id && e.kind === "reminder",
        )
      )
        continue;
      this.emailRows.push({
        id: randomUUID(),
        clinic_id: row.clinic_id,
        appointment_id: row.id,
        kind: "reminder",
        claimed_at: null,
        claim_token: null,
        sent_at: null,
        attempts: 0,
      });
    }
  }
  async claimEmails(token: string, appointmentId?: string) {
    const rows = this.emailRows
      .filter(
        (e) =>
          !e.sent_at &&
          (!e.claimed_at || Date.parse(e.claimed_at) < Date.now() - 300_000) &&
          (!appointmentId || e.appointment_id === appointmentId),
      )
      .slice(0, 50);
    for (const row of rows) {
      row.claimed_at = new Date().toISOString();
      row.claim_token = token;
      row.attempts++;
    }
    return rows;
  }
  async finishEmail(id: string, token: string, success: boolean) {
    const row = this.emailRows.find(
      (e) => e.id === id && e.claim_token === token && !e.sent_at,
    );
    if (!row) return;
    row.sent_at = success ? new Date().toISOString() : null;
    row.claimed_at = null;
    row.claim_token = null;
    if (success && row.kind === "reminder")
      (
        await this.appointment(row.clinic_id, row.appointment_id)
      ).reminder_sent_at = row.sent_at;
  }
  async clinic(id: string) {
    const row = this.clinics.find((c) => c.id === id);
    if (!row) throw new AppError(404, "CLINIC_NOT_FOUND", "Clinic not found");
    return row;
  }
  async conversation(clinicId: string, id?: string) {
    if (id) {
      const row = this.conversationRows.find(
        (c) => c.id === id && c.clinic_id === clinicId,
      );
      if (!row)
        throw new AppError(
          404,
          "CONVERSATION_NOT_FOUND",
          "Conversation not found",
        );
      return row;
    }
    const row: Conversation = {
      id: randomUUID(),
      clinic_id: clinicId,
      status: "active",
      handoff_reason: null,
      pending_booking: null,
      created_at: new Date().toISOString(),
    };
    this.conversationRows.push(row);
    return row;
  }
  async acquire(id: string, clinicId: string, lease: string) {
    const conversation = await this.conversation(clinicId, id);
    if ((this.locks.get(id)?.expires ?? 0) > Date.now())
      throw new AppError(
        409,
        "CONVERSATION_BUSY",
        "Please wait for the previous reply.",
      );
    this.locks.set(id, { lease, expires: Date.now() + 300_000 });
    return conversation;
  }
  async release(id: string, _clinicId: string, lease: string) {
    if (this.locks.get(id)?.lease === lease) this.locks.delete(id);
  }
  async updateConversation(
    id: string,
    clinicId: string,
    patch: Partial<Conversation>,
  ) {
    Object.assign(await this.conversation(clinicId, id), patch);
  }
  async messages(id: string) {
    return this.messageRows.filter((m) => m.conversation_id === id).slice(-30);
  }
  async addMessage(id: string, role: Message["role"], content: string) {
    this.messageRows.push({
      id: randomUUID(),
      conversation_id: id,
      role,
      content,
      created_at: new Date().toISOString(),
    });
  }
  async search(clinicId: string, embedding: number[], query?: string) {
    const terms = (query?.toLowerCase().match(/[a-z]+/g) ?? []).filter(
      (t) =>
        t.length > 2 &&
        !["what", "are", "the", "your", "can", "you", "tell", "about"].includes(
          t,
        ),
    );
    return this.documents
      .filter(
        (d) =>
          d.clinic_id === clinicId &&
          (!query ||
            terms.some((t) =>
              `${d.title} ${d.content}`
                .toLowerCase()
                .split(/[^a-z]+/)
                .includes(t),
            )),
      )
      .map((d) => ({
        ...d,
        embedding: undefined,
        similarity: d.embedding!.reduce(
          (sum, n, i) => sum + n * embedding[i],
          0,
        ),
      }))
      .filter((d) => d.similarity > 0.15)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 4);
  }
  async slots(clinicId: string, from: string, to: string) {
    return this.slotRows
      .filter(
        (s) =>
          s.clinic_id === clinicId &&
          !s.is_booked &&
          s.starts_at >= from &&
          s.starts_at <= to,
      )
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .slice(0, 6);
  }
  async logUsage(usage: Usage) {
    this.usageRows.push({
      ...usage,
      id: randomUUID(),
      created_at: new Date().toISOString(),
    });
  }
}
export function createRepository(config: Config): Repository {
  if (config.DEMO_MODE) return new MemoryRepository();
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error("Set Supabase credentials or use local DEMO_MODE=true");
  return new SupabaseRepository(
    createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  );
}
