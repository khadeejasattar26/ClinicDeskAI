# Milestone verification

All checks use Node 20.20.2 and MOCK_LLM=true. Each numbered milestone has its own Git commit.

1. Scaffold: 7 Jest tests passed; server line coverage 100%; lint, both workspace typechecks and both production builds passed. Frontend tests begin in milestone 6.
2. Database: 14 Jest tests passed, including executing the migration in PostgreSQL/pgvector, anonymous denial, staff tenant isolation, membership escalation denial, scoped retrieval, atomic duplicate booking and outbox claims. Typechecks and lint passed. Live Supabase provisioning requires user credentials.
3. Agent/RAG: 36 Jest tests passed; server line coverage 99.55%. Verified clinic questions, unknown facts, slot availability, schema validation, 20/minute limit, five-iteration bound, conversation leases, medical/emergency responses, usage recording, safe provider failures and Supabase/OpenAI adapters. Typechecks and lint passed.
