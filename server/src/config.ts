import { z } from "zod";

const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  MOCK_LLM: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  DEMO_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
  OPENAI_API_KEY: optionalSecret,
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  OPENAI_INPUT_COST_PER_MILLION: z.coerce.number().nonnegative().default(0),
  OPENAI_OUTPUT_COST_PER_MILLION: z.coerce.number().nonnegative().default(0),
  OPENAI_EMBEDDING_COST_PER_MILLION: z.coerce.number().nonnegative().default(0),
  RESEND_API_KEY: optionalSecret,
  EMAIL_FROM: z.string().default("CareWell <appointments@example.com>"),
  CRON_SECRET: z.string().min(24).default("local-demo-cron-secret-change-me"),
  CHAT_RATE_LIMIT: z.coerce.number().int().positive().default(20),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
  LOG_LEVEL: z.string().default("info"),
});
export type Config = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = schema.parse(env);
  if (config.NODE_ENV === "production" && config.DEMO_MODE)
    throw new Error("Demo mode is local-only");
  if (
    config.NODE_ENV === "production" &&
    config.CRON_SECRET === "local-demo-cron-secret-change-me"
  )
    throw new Error("Set a private CRON_SECRET");
  return config;
}
