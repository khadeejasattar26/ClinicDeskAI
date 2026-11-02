# Milestone verification

All checks use Node 20.20.2 and MOCK_LLM=true. Each numbered milestone has its own Git commit.

1. Scaffold: 7 Jest tests passed; server line coverage 100%; lint, both workspace typechecks and both production builds passed. Frontend tests begin in milestone 6.
2. Database: 14 Jest tests passed, including executing the migration in PostgreSQL/pgvector, anonymous denial, staff tenant isolation, membership escalation denial, scoped retrieval, atomic duplicate booking and outbox claims. Typechecks and lint passed. Live Supabase provisioning requires user credentials.
3. Agent/RAG: 36 Jest tests passed; server line coverage 99.55%. Verified clinic questions, unknown facts, slot availability, schema validation, 20/minute limit, five-iteration bound, conversation leases, medical/emergency responses, usage recording, safe provider failures and Supabase/OpenAI adapters. Typechecks and lint passed.
4. Booking/reception: 43 Jest tests passed; server line coverage 99.70%. Verified explicit confirmation, changed-detail review, concurrent conflict, email delivery attempt, durable retry with stable idempotency key, lead capture, handoff and adapter clinic scoping. Typechecks and lint passed.
5. Reminders: 52 Jest tests passed; server line coverage 99.44%. Verified secret authorization, 23–25-hour eligibility, one-time delivery, overlapping-job exclusion, failed-delivery retry, claim expiration and cancellation suppression. Typechecks and lint passed. Hourly workflow added; deployment secrets must be configured manually.
6. Patient web UI: all 52 server and 3 React tests passed; server line coverage 99.44%. Both builds, typechecks and lint passed. Verified the page renders and a real quick-reply request returns a sourced hours answer in Safari. Demo seed command also passed. Responsive CSS includes narrow-screen layouts; mobile device emulation was not available through the native browser surface.
