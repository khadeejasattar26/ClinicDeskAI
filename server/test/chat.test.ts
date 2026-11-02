import request from "supertest";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createServices } from "../src/services";
import { MemoryRepository } from "../src/repository";
import { CLINIC_ID } from "../src/demo-data";
import { Agent } from "../src/agent";
import type { AIProvider, Completion } from "../src/ai";

const config = loadConfig({
  NODE_ENV: "test",
  MOCK_LLM: "true",
  DEMO_MODE: "true",
});
const setup = () => {
  const services = createServices(config);
  return {
    services,
    app: createApp(config, services),
    repo: services.repo as MemoryRepository,
  };
};
test.each([
  {},
  { clinicId: "bad", message: "hello" },
  { clinicId: CLINIC_ID, message: " " },
  { clinicId: CLINIC_ID, message: "x".repeat(2001) },
  { clinicId: CLINIC_ID, message: "Hi", admin: true },
])("chat rejects invalid input", async (body) => {
  const { app } = setup();
  const res = await request(app).post("/api/chat").send(body);
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe("VALIDATION_ERROR");
});
test("clinic question is answered from retrieved documents and usage is recorded", async () => {
  const { app, repo } = setup();
  const res = await request(app)
    .post("/api/chat")
    .send({ clinicId: CLINIC_ID, message: "Opening hours" });
  expect(res.status).toBe(200);
  expect(res.body.reply).toContain("9:00 am");
  expect(res.body.reply).toContain("Source: Opening hours");
  expect(repo.messageRows.map((m) => m.role)).toEqual(["user", "assistant"]);
  expect(repo.usageRows).toHaveLength(3);
  expect(repo.usageRows.every((u) => u.estimated_cost_usd === 0)).toBe(true);
  const next = await request(app).post("/api/chat").send({
    clinicId: CLINIC_ID,
    conversationId: res.body.conversationId,
    message: "Fees",
  });
  expect(next.body.reply).toContain("2,000");
});
test("booking enquiry returns six future free slots", async () => {
  const { app } = setup();
  const res = await request(app)
    .post("/api/chat")
    .send({ clinicId: CLINIC_ID, message: "Book an appointment" });
  expect(res.status).toBe(200);
  const slots = res.body.actions.find(
    (a: { type: string }) => a.type === "slots",
  ).data;
  expect(slots).toHaveLength(6);
  expect(
    slots.every(
      (s: { starts_at: string }) => Date.parse(s.starts_at) > Date.now(),
    ),
  ).toBe(true);
});
test("unknown facts are not invented and unknown conversation IDs are not accepted", async () => {
  const { app } = setup();
  const res = await request(app)
    .post("/api/chat")
    .send({ clinicId: CLINIC_ID, message: "xyzzy quantum elephants" });
  expect(res.body.reply).toContain("don't have that information");
  expect(
    (
      await request(app).post("/api/chat").send({
        clinicId: CLINIC_ID,
        conversationId: "99999999-9999-4999-8999-999999999999",
        message: "Hi",
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await request(app).post("/api/chat").send({
        clinicId: "99999999-9999-4999-8999-999999999999",
        message: "Hi",
      })
    ).status,
  ).toBe(404);
});
test.each([
  ["I have chest pain", "1122"],
  ["diagnose my illness", "cannot diagnose"],
])("safety response bypasses AI: %s", async (message, phrase) => {
  const { app, repo } = setup();
  const res = await request(app)
    .post("/api/chat")
    .send({ clinicId: CLINIC_ID, message });
  expect(res.body.reply).toContain(phrase);
  expect(repo.usageRows).toHaveLength(0);
});
test("rate limit is twenty requests per minute per IP", async () => {
  const { app } = setup();
  for (let i = 0; i < 20; i++)
    expect((await request(app).post("/api/chat").send({})).status).toBe(400);
  const res = await request(app).post("/api/chat").send({});
  expect(res.status).toBe(429);
  expect(res.body.error.code).toBe("RATE_LIMITED");
});
function scripted(result: Completion | Error): AIProvider {
  return {
    model: "test",
    embed: async () => ({ vector: Array(1536).fill(0), tokens: 1 }),
    complete: jest.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}
test("tool loop stops after five iterations and locks are released", async () => {
  const repo = new MemoryRepository();
  const ai = scripted({
    content: null,
    calls: [
      {
        id: "a",
        name: "search_knowledge_base",
        arguments: '{"query":"hours"}',
      },
    ],
    promptTokens: 5,
    completionTokens: 1,
  });
  const agent = new Agent(repo, ai, config);
  const result = await agent.chat(CLINIC_ID, "hours");
  expect(ai.complete).toHaveBeenCalledTimes(5);
  expect(result.reply).toContain("could not complete");
  await expect(
    agent.chat(CLINIC_ID, "again", result.conversationId),
  ).resolves.toBeDefined();
});
test.each([
  ["unknown", '{"query":"hours"}', "INVALID_TOOL"],
  ["search_knowledge_base", "{", "INVALID_TOOL_ARGUMENTS"],
  ["search_knowledge_base", '{"query":3}', "VALIDATION_ERROR"],
  [
    "get_available_slots",
    '{"date_from":"bad","date_to":"bad"}',
    "VALIDATION_ERROR",
  ],
])("tool inputs are validated: %s", async (name, args, code) => {
  const { services } = setup();
  services.agent.ai = scripted({
    content: null,
    calls: [{ id: "a", name, arguments: args }],
    promptTokens: 0,
    completionTokens: 0,
  });
  const res = await request(createApp(config, services))
    .post("/api/chat")
    .send({ clinicId: CLINIC_ID, message: "hello" });
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe(code);
});
test("provider failure returns a safe 503 and logs the failed call", async () => {
  const { services, repo } = setup();
  services.agent.ai = scripted(new Error("secret provider response"));
  const res = await request(createApp(config, services))
    .post("/api/chat")
    .send({ clinicId: CLINIC_ID, message: "hello" });
  expect(res.status).toBe(503);
  expect(JSON.stringify(res.body)).not.toContain("secret");
  expect(repo.usageRows).toHaveLength(1);
});
test("conversation lease prevents parallel turns and cross-clinic reuse", async () => {
  const repo = new MemoryRepository();
  const c = await repo.conversation(CLINIC_ID);
  await repo.acquire(c.id, CLINIC_ID, "a");
  await expect(repo.acquire(c.id, CLINIC_ID, "b")).rejects.toMatchObject({
    status: 409,
  });
  await repo.release(c.id, CLINIC_ID, "b");
  await expect(repo.acquire(c.id, CLINIC_ID, "c")).rejects.toMatchObject({
    status: 409,
  });
  await repo.release(c.id, CLINIC_ID, "a");
  await expect(repo.acquire(c.id, CLINIC_ID, "c")).resolves.toMatchObject({
    id: c.id,
  });
  await expect(repo.conversation("another-clinic", c.id)).rejects.toMatchObject(
    { status: 404 },
  );
  await repo.updateConversation(c.id, CLINIC_ID, { status: "follow_up" });
  expect(c.status).toBe("follow_up");
});

test("embedding failures are safely reported and usage includes the failed attempt", async () => {
  const { services, repo } = setup();
  services.agent.ai.embed = async () => {
    throw new Error("private embedding failure");
  };
  const res = await request(createApp(config, services))
    .post("/api/chat")
    .send({ clinicId: CLINIC_ID, message: "hours" });
  expect(res.status).toBe(503);
  expect(res.body.error.code).toBe("AI_UNAVAILABLE");
  expect(repo.usageRows).toHaveLength(2);
});
test("oversized bodies return a consistent 413", async () => {
  const { app } = setup();
  const res = await request(app)
    .post("/api/chat")
    .send({ clinicId: CLINIC_ID, message: "a".repeat(20_000) });
  expect(res.status).toBe(413);
  expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
});
test("excessive parallel tool calls are rejected", async () => {
  const { services } = setup();
  services.agent.ai = scripted({
    content: null,
    calls: Array.from({ length: 6 }, (_, i) => ({
      id: String(i),
      name: "search_knowledge_base",
      arguments: '{"query":"hours"}',
    })),
    promptTokens: 1,
    completionTokens: 1,
  });
  const res = await request(createApp(config, services))
    .post("/api/chat")
    .send({ clinicId: CLINIC_ID, message: "hours" });
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe("TOOL_LIMIT");
});
