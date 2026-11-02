import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
const errors = new Rate("clinicdesk_errors");
const chatLatency = new Trend("chat_latency", true);
const healthLatency = new Trend("health_latency", true);
const base = (__ENV.BASE_URL || "http://127.0.0.1:3002").replace(/\/$/, "");
const clinicId = __ENV.CLINIC_ID || "11111111-1111-4111-8111-111111111111";
export const options = {
  scenarios: {
    clinic_chat: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [{ duration: "1m", target: 50 }],
      gracefulRampDown: "5s",
      gracefulStop: "5s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    clinicdesk_errors: ["rate<0.01"],
    chat_latency: ["p(95)<1500"],
    health_latency: ["p(95)<500"],
  },
  summaryTrendStats: ["avg", "med", "p(95)", "max"],
};
export function setup() {
  const response = http.get(`${base}/api/health`);
  if (response.status !== 200 || response.json("llm") !== "mock")
    throw new Error(
      "Load tests require a healthy server with MOCK_LLM=true. Use the isolated load server command in README.",
    );
}
export default function () {
  const health = http.get(`${base}/api/health`, { tags: { name: "health" } });
  healthLatency.add(health.timings.duration);
  const healthy = check(health, { "health is ok": (r) => r.status === 200 });
  const chat = http.post(
    `${base}/api/chat`,
    JSON.stringify({ clinicId, message: "Opening hours" }),
    { headers: { "Content-Type": "application/json" }, tags: { name: "chat" } },
  );
  chatLatency.add(chat.timings.duration);
  const answered = check(chat, {
    "chat succeeds": (r) => r.status === 200,
    "chat has a sourced answer": (r) => {
      try {
        return String(r.json("reply")).includes("Source:");
      } catch {
        return false;
      }
    },
  });
  errors.add(!healthy || !answered);
  sleep(1);
}
export function handleSummary(data) {
  const p95 = (name) =>
    data.metrics[name]?.values["p(95)"]?.toFixed(2) ?? "n/a";
  const rate = (data.metrics.clinicdesk_errors?.values.rate ?? 0) * 100;
  return {
    "load/results.json": JSON.stringify(data, null, 2),
    stdout: `\nClinicDesk AI · 60-second ramp to 50 VUs\nHealth p95: ${p95("health_latency")} ms\nChat p95: ${p95("chat_latency")} ms\nHTTP p95: ${p95("http_req_duration")} ms\nError rate: ${rate.toFixed(2)}%\nRequests: ${data.metrics.http_reqs?.values.count}\nDetailed metrics: load/results.json\n`,
  };
}
