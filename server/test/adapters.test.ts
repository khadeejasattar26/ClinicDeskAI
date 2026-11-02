import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import {
  SupabaseRepository,
  createRepository,
  MemoryRepository,
  unwrap,
} from "../src/repository";
import { OpenAIProvider, MockAIProvider, createAI, usageCost } from "../src/ai";
import { loadConfig } from "../src/config";
import { CLINIC_ID } from "../src/demo-data";
const config = loadConfig({ MOCK_LLM: "true" });
function gateway() {
  let data: unknown = null;
  let status = 200;
  const fetcher = jest.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  const db = createClient("https://clinic.example.com", "fake-key", {
    global: { fetch: fetcher },
    auth: { persistSession: false },
  });
  return {
    repo: new SupabaseRepository(db),
    fetcher,
    respond: (value: unknown, code = 200) => {
      data = value;
      status = code;
    },
  };
}
test("Supabase reads and writes constrain clinic IDs at the service-role boundary", async () => {
  const { repo, fetcher, respond } = gateway();
  respond({ id: CLINIC_ID });
  expect((await repo.clinic(CLINIC_ID)).id).toBe(CLINIC_ID);
  await repo.conversation(CLINIC_ID);
  await repo.conversation(CLINIC_ID, "conversation");
  expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain(
    "clinic_id=eq." + CLINIC_ID,
  );
  respond([{ id: "conversation" }]);
  await repo.acquire("conversation", CLINIC_ID, "lease");
  expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain(
    "acquire_conversation",
  );
  await repo.release("conversation", CLINIC_ID, "lease");
  expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain("lease_id=eq.lease");
  await repo.updateConversation("conversation", CLINIC_ID, {
    status: "follow_up",
  });
  expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain(
    "clinic_id=eq." + CLINIC_ID,
  );
  respond([{ role: "assistant" }, { role: "user" }]);
  expect((await repo.messages("conversation"))[0].role).toBe("user");
  await repo.addMessage("conversation", "user", "hello");
  await repo.search(CLINIC_ID, [1, 0]);
  const searchCall = fetcher.mock.calls.at(-1) as unknown as [
    string,
    RequestInit,
  ];
  expect(JSON.parse(String(searchCall[1].body))).toMatchObject({
    clinic_id: CLINIC_ID,
    match_count: 4,
  });
  await repo.slots(CLINIC_ID, "2026-01-01", "2026-02-01");
  expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain(
    "is_booked=eq.false",
  );
  await repo.logUsage({
    conversation_id: "c",
    model: "mock",
    prompt_tokens: 0,
    completion_tokens: 0,
    estimated_cost_usd: 0,
    latency_ms: 1,
  });
  respond(null);
  await expect(repo.clinic(CLINIC_ID)).rejects.toMatchObject({ status: 404 });
  await expect(repo.conversation(CLINIC_ID, "missing")).rejects.toMatchObject({
    status: 404,
  });
  respond([]);
  await expect(repo.acquire("c", CLINIC_ID, "l")).rejects.toMatchObject({
    status: 409,
  });
});
test("database errors map to conflicts or safe unavailable errors", () => {
  expect(() =>
    unwrap({ data: null, error: { code: "23505", message: "private sql" } }),
  ).toThrow("no longer available");
  expect(() =>
    unwrap({ data: null, error: { message: "private sql" } }),
  ).toThrow("temporarily unavailable");
});
test("factory configuration fails fast without network access or credentials", () => {
  expect(() => createRepository(config)).toThrow("Supabase");
  expect(createRepository(loadConfig({ DEMO_MODE: "true" }))).toBeInstanceOf(
    MemoryRepository,
  );
  expect(
    createRepository(
      loadConfig({
        SUPABASE_URL: "https://clinic.example.com",
        SUPABASE_SERVICE_ROLE_KEY: "fake",
      }),
    ),
  ).toBeInstanceOf(SupabaseRepository);
  expect(createAI(config)).toBeInstanceOf(MockAIProvider);
  expect(() => createAI(loadConfig({}))).toThrow("OPENAI_API_KEY");
  expect(createAI(loadConfig({ OPENAI_API_KEY: "fake" }))).toBeInstanceOf(
    OpenAIProvider,
  );
  expect(
    usageCost(
      {
        ...config,
        OPENAI_INPUT_COST_PER_MILLION: 1,
        OPENAI_OUTPUT_COST_PER_MILLION: 2,
      },
      100,
      100,
    ),
  ).toBeCloseTo(0.0003);
});
test("official OpenAI SDK adapter passes tools, model, dimensions and usage correctly", async () => {
  const fetcher = jest.fn(
    async (url: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          String(url).includes("embeddings")
            ? { data: [{ embedding: [1, 0] }], usage: { total_tokens: 7 } }
            : {
                choices: [
                  {
                    message: {
                      content: null,
                      tool_calls: [
                        {
                          id: "t",
                          type: "function",
                          function: {
                            name: "search_knowledge_base",
                            arguments: '{"query":"hours"}',
                          },
                        },
                      ],
                    },
                  },
                ],
                usage: { prompt_tokens: 10, completion_tokens: 2 },
              },
        ),
        { headers: { "content-type": "application/json" } },
      ),
  );
  const client = new OpenAI({ apiKey: "fake", fetch: fetcher });
  const provider = new OpenAIProvider(config, client);
  expect((await provider.embed("hours")).tokens).toBe(7);
  const result = await provider.complete(
    [{ role: "user", content: "hours" }],
    [],
  );
  expect(result.calls[0].name).toBe("search_knowledge_base");
  expect(result.promptTokens).toBe(10);
});
