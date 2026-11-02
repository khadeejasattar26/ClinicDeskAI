import request from "supertest";
import { Resend } from "resend";
import { createApp } from "../src/app";
import { createServices } from "../src/services";
import { loadConfig } from "../src/config";
import { MemoryRepository, SupabaseRepository } from "../src/repository";
import { ClinicMailer, EmailService, type Mailer } from "../src/email";
import { CLINIC_ID } from "../src/demo-data";
import type { BookingInput } from "../src/domain";
import { createClient } from "@supabase/supabase-js";
const config = loadConfig({
  NODE_ENV: "test",
  MOCK_LLM: "true",
  DEMO_MODE: "true",
});
function setup() {
  const services = createServices(config);
  const repo = services.repo as MemoryRepository;
  const mailer: Mailer = { send: jest.fn(async () => {}) };
  const emails = new EmailService(repo, mailer);
  services.emails = emails;
  services.agent.emails = emails;
  return { app: createApp(config, services), services, repo, mailer };
}
function details(repo: MemoryRepository): BookingInput {
  return {
    slot_id: repo.slotRows[0].id,
    patient_name: "Demo Patient",
    patient_email: "patient@example.com",
    patient_phone: "+923001234567",
    reason: "General consultation",
  };
}
test("booking needs explicit confirmation, creates one appointment and sends one email", async () => {
  const { app, repo, mailer } = setup();
  const args = details(repo);
  const prepare = await request(app)
    .post("/api/chat")
    .send({
      clinicId: CLINIC_ID,
      message: `Booking details: ${JSON.stringify(args)}`,
    });
  expect(prepare.status).toBe(200);
  expect(prepare.body.actions[0]).toMatchObject({
    type: "confirm_booking",
    data: args,
  });
  expect(repo.appointmentRows).toHaveLength(0);
  expect(mailer.send).not.toHaveBeenCalled();
  const confirm = await request(app).post("/api/chat").send({
    clinicId: CLINIC_ID,
    conversationId: prepare.body.conversationId,
    message: "Confirm booking",
  });
  expect(confirm.status).toBe(200);
  expect(confirm.body.actions[0].type).toBe("booked");
  expect(repo.appointmentRows).toHaveLength(1);
  expect(mailer.send).toHaveBeenCalledTimes(1);
  expect(mailer.send).toHaveBeenCalledWith(
    expect.objectContaining({
      to: args.patient_email,
      text: expect.stringContaining("Pakistan time"),
    }),
  );
  expect(repo.conversationRows[0].pending_booking).toBeNull();
  await request(app).post("/api/chat").send({
    clinicId: CLINIC_ID,
    conversationId: prepare.body.conversationId,
    message: "Confirm booking",
  });
  expect(repo.appointmentRows).toHaveLength(1);
});
test("concurrent bookings for the same slot return one success and one 409", async () => {
  const { app, repo } = setup();
  const payload = {
    clinicId: CLINIC_ID,
    message: `Booking details: ${JSON.stringify(details(repo))}`,
  };
  const preparations = await Promise.all([
    request(app).post("/api/chat").send(payload),
    request(app).post("/api/chat").send(payload),
  ]);
  const responses = await Promise.all(
    preparations.map((p) =>
      request(app).post("/api/chat").send({
        clinicId: CLINIC_ID,
        conversationId: p.body.conversationId,
        message: "Confirm booking",
      }),
    ),
  );
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(repo.appointmentRows).toHaveLength(1);
});
test("changed details trigger a new review even after confirmation", async () => {
  const { services, repo } = setup();
  const c = await repo.conversation(CLINIC_ID);
  c.pending_booking = details(repo);
  const actions: { type: string; data: unknown }[] = [];
  await services.agent.tool(
    "book_appointment",
    { ...details(repo), patient_name: "Other Person" },
    c,
    actions,
    "Confirm booking",
  );
  expect(repo.appointmentRows).toHaveLength(0);
  expect(actions[0].type).toBe("confirm_booking");
  await expect(
    services.agent.tool(
      "book_appointment",
      { ...details(repo), slot_id: "99999999-9999-4999-8999-999999999999" },
      c,
      [],
      "book",
    ),
  ).rejects.toMatchObject({ status: 409 });
});
test("cancel clears pending details; lead capture and human handoff persist", async () => {
  const { app, repo } = setup();
  const c = await repo.conversation(CLINIC_ID);
  c.pending_booking = details(repo);
  const send = (message: string) =>
    request(app)
      .post("/api/chat")
      .send({ clinicId: CLINIC_ID, conversationId: c.id, message });
  expect((await send("cancel booking")).body.reply).toContain("cleared");
  expect(c.pending_booking).toBeNull();
  const lead = {
    name: "Demo Person",
    contact: "person@example.com",
    message: "Please call me about telehealth",
  };
  expect((await send("Lead details: " + JSON.stringify(lead))).status).toBe(
    200,
  );
  expect(repo.leadRows[0]).toMatchObject({ ...lead, clinic_id: CLINIC_ID });
  expect((await send("Please handoff to a human")).body.actions[0].type).toBe(
    "handoff",
  );
  expect(c.status).toBe("follow_up");
  expect(c.handoff_reason).toContain("human");
});
test("email failures preserve a confirmed appointment and retry from the outbox", async () => {
  const { repo } = setup();
  const appointment = await repo.book(CLINIC_ID, details(repo));
  const send = jest
    .fn()
    .mockRejectedValueOnce(new Error("provider down"))
    .mockResolvedValue(undefined);
  const emails = new EmailService(repo, { send });
  expect(await emails.sendPending(appointment.id)).toEqual({
    sent: 0,
    failed: 1,
  });
  expect(repo.appointmentRows[0].status).toBe("confirmed");
  expect(await emails.sendPending(appointment.id)).toEqual({
    sent: 1,
    failed: 0,
  });
  expect(await emails.sendPending(appointment.id)).toEqual({
    sent: 0,
    failed: 0,
  });
  expect(send.mock.calls[0][0].idempotencyKey).toBe(
    send.mock.calls[1][0].idempotencyKey,
  );
  await expect(
    repo.appointment("other-clinic", appointment.id),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    repo.availableSlot("other-clinic", appointment.slot_id),
  ).rejects.toMatchObject({ status: 409 });
});
test("email provider uses idempotency keys and supports console preview mode", async () => {
  const message = {
    to: "demo@example.com",
    subject: "Test",
    text: "Preview",
    idempotencyKey: "id",
  };
  await expect(new ClinicMailer(config).send(message)).resolves.toBeUndefined();
  const send = jest
    .fn()
    .mockResolvedValue({ data: { id: "sent" }, error: null });
  const provider = new ClinicMailer(config, {
    emails: { send },
  } as unknown as Resend);
  await provider.send(message);
  expect(send.mock.calls[0][1]).toMatchObject({ idempotencyKey: "id" });
  send.mockResolvedValue({ data: null, error: { message: "secret" } });
  await expect(provider.send(message)).rejects.toThrow(
    "Email provider unavailable",
  );
});
test("production booking adapter scopes all writes and claims email through RPC", async () => {
  let data: unknown = {
    ...details(new MemoryRepository()),
    id: "appointment",
    clinic_id: CLINIC_ID,
    slots: { starts_at: new Date().toISOString() },
  };
  const fetcher = jest.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json" },
      }),
  );
  const repo = new SupabaseRepository(
    createClient("https://clinic.example.com", "fake", {
      global: { fetch: fetcher },
      auth: { persistSession: false },
    }),
  );
  await repo.book(CLINIC_ID, details(new MemoryRepository()));
  expect(String(fetcher.mock.calls.at(-1)![0])).toContain(
    "clinic_id=eq." + CLINIC_ID,
  );
  await repo.availableSlot(CLINIC_ID, "slot");
  await repo.createLead(CLINIC_ID, {
    name: "Demo",
    contact: "demo@example.com",
    message: "hello",
  });
  const body = JSON.parse(String(fetcher.mock.calls.at(-1)![1]?.body));
  expect(body.clinic_id).toBe(CLINIC_ID);
  data = [];
  await repo.claimEmails("token", "appointment");
  expect(JSON.parse(String(fetcher.mock.calls.at(-1)![1]?.body))).toMatchObject(
    { p_token: "token", p_appointment_id: "appointment" },
  );
  await repo.finishEmail("email", "token", true);
  data = null;
  await expect(repo.appointment(CLINIC_ID, "missing")).rejects.toMatchObject({
    status: 404,
  });
  await expect(repo.availableSlot(CLINIC_ID, "missing")).rejects.toMatchObject({
    status: 409,
  });
});

test("a model cannot prepare and confirm a new proposal within the same patient turn", async () => {
  const { app, services, repo } = setup();
  const args = details(repo);
  services.agent.ai.complete = jest.fn(async () => ({
    content: null,
    promptTokens: 0,
    completionTokens: 0,
    calls: [0, 1].map((i) => ({
      id: String(i),
      name: "book_appointment",
      arguments: JSON.stringify(args),
    })),
  }));
  const res = await request(app)
    .post("/api/chat")
    .send({ clinicId: CLINIC_ID, message: "Confirm booking" });
  expect(res.status).toBe(200);
  expect(repo.appointmentRows).toHaveLength(0);
  expect(
    res.body.actions.every(
      (action: { type: string }) => action.type === "confirm_booking",
    ),
  ).toBe(true);
});

test("an uncompleted model turn cannot leave an unseen proposal available for confirmation", async () => {
  const { app, services, repo } = setup();
  const args = details(repo);
  services.agent.ai.complete = jest
    .fn()
    .mockResolvedValueOnce({
      content: null,
      promptTokens: 0,
      completionTokens: 0,
      calls: [
        {
          id: "prepare",
          name: "book_appointment",
          arguments: JSON.stringify(args),
        },
      ],
    })
    .mockRejectedValueOnce(new Error("provider unavailable"));
  const res = await request(app)
    .post("/api/chat")
    .send({ clinicId: CLINIC_ID, message: "Please book an appointment" });
  expect(res.status).toBe(503);
  expect(repo.conversationRows[0].pending_booking).toBeNull();
  expect(repo.appointmentRows).toHaveLength(0);
});

test("confirmation compares fields independent of PostgreSQL JSONB key order", async () => {
  const { app, repo } = setup();
  const args = details(repo);
  const c = await repo.conversation(CLINIC_ID);
  c.pending_booking = Object.fromEntries(
    Object.entries(args).reverse(),
  ) as unknown as BookingInput;
  const res = await request(app)
    .post("/api/chat")
    .send({
      clinicId: CLINIC_ID,
      conversationId: c.id,
      message: "Confirm booking",
    });
  expect(res.status).toBe(200);
  expect(
    res.body.actions.some(
      (action: { type: string }) => action.type === "booked",
    ),
  ).toBe(true);
  expect(repo.appointmentRows).toHaveLength(1);
});
