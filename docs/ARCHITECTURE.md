# Architecture and interview walkthrough

## The story in 30 seconds

“A patient chats with a fictional clinic’s receptionist. Express validates the message and clinic, loads only that conversation, then runs a bounded OpenAI tool loop. Clinic facts come from documents stored in PostgreSQL with vector embeddings. A booking first becomes a review card; only an explicit confirmation can trigger the atomic booking function. That transaction also queues an email. Staff authenticate with Supabase and can inspect only their own clinic’s bookings, leads, conversations and usage. An hourly, secret-protected job queues next-day reminders and retries pending emails.”

## Why a two-workspace monorepo?

`server` and `web` have separate build/test tools but one lockfile and consistent root commands. It is easy to review an API and the UI that consumes it together. The API remains deployable as a small Docker service, while the web app is a static build. React Router handles patient and staff routes; the admin code is loaded on demand. CSS modules keep the clinic and dashboard styles maintainable without a UI dependency.

## Why RAG with pgvector?

The assistant should use the clinic’s published information instead of inventing hours, fees or services. Each of the twelve short markdown documents is already one self-contained chunk. Seed creates 1536-dimensional embeddings; `search_knowledge_base` embeds a query and asks `match_documents` for up to four rows using cosine distance. A larger document pipeline would split long documents and version chunks before embedding them.

pgvector keeps vectors, clinic identifiers and relational records together. We can enforce clinic scoping in the SQL query and RLS instead of maintaining a second vector database and a second permission model. The HNSW index is there for growth; exact search is also adequate for this tiny seed dataset. `match_documents` takes a clinic ID and remains security-invoker, so staff cannot use it to bypass RLS.

Retrieved text is returned as JSON tool data. The system prompt explicitly says it cannot change the assistant’s rules. Medical diagnosis and prescribing are prohibited, and selected emergency/medical-advice phrases get a code-level response before the LLM runs. A prompt is still not a formal proof of factuality: the project needs domain evaluation and clinical review before any real deployment.

Sources: [Supabase pgvector](https://supabase.com/docs/guides/database/extensions/pgvector), [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling).

## Why a maximum of five iterations?

A tool loop is useful because answering can require retrieval or checking availability before composing a reply. It can also loop indefinitely if the model repeats a call. Five iterations cap latency and cost while allowing a short sequence of useful actions. Each model result is appended as an assistant tool-call message, then validated tool outputs are appended using matching call IDs. The API accepts at most five calls in one iteration, and asks OpenAI to disable parallel tool calls.

Each tool has a zod schema, an explicit implementation and an OpenAI function definition. Unsupported names, malformed JSON and invalid arguments stop safely; the model never gets arbitrary database or shell access. Outgoing chat/embedding calls have a timeout and no automatic OpenAI SDK retries. Successful usage and failed attempts are recorded with model, tokens, latency and a configurable estimate. Failed calls have unknown token usage recorded as zero; billing reconciliation belongs in provider reporting.

## How does booking confirmation really work?

The model does not get to decide that a patient has confirmed. The server stores the proposed complete booking in `conversations.pending_booking`, validates that the selected slot is currently available and returns a review action. The website displays the time, name, email, phone and reason. A later exact confirmation such as “Confirm booking” is required, and the tool arguments must equal the stored proposal. Confirmation is restricted to the proposal that existed at the start of the patient’s turn: repeated model tool calls cannot create and approve a proposal in one turn. Field comparison is independent of JSON key order, including PostgreSQL JSONB reordering. Failed turns clear any uncompleted proposal. Changed details trigger a fresh review. Cancellation clears only the pending proposal; it does not silently cancel an existing appointment.

Conversation leases serialize turns across API instances. A lease lasts five minutes and is released in `finally`; a different token cannot release it. The context history is bounded to the most recent 30 messages for the model. Staff can paginate the full stored transcript, so bounded model context does not erase the audit trail.

## How is booking race-safe?

`book_appointment` is one PostgreSQL function invocation and therefore one transaction. It conditionally updates the requested future slot only when the clinic matches and `is_booked=false`. Concurrent updates serialize on the row; the second request sees that it is booked and raises a conflict. A unique constraint on `appointments.slot_id` provides a second invariant. Composite foreign keys prevent an appointment from referring to another clinic’s slot.

The function inserts both the appointment and its confirmation outbox row before returning. If either insert fails, the slot update rolls back too. The service translates unavailable/duplicate slot errors to HTTP 409. Checking availability earlier is only for the user experience; it is never the final concurrency check.

## How does RLS isolate clinics?

Supabase Auth establishes the staff identity. `staff_profiles` maps an Auth user to one clinic. A narrow security-definer helper reads that mapping without recursively invoking the profile policy; its search path is empty, its table is schema-qualified and public execution is revoked.

Policies check the current staff clinic for direct clinic-owned rows. Messages and usage go through their parent conversation. Anonymous users have no table privileges. Staff can read their own membership but cannot write it, preventing self-promotion to another clinic. Audit usage and the outbox are read-only to staff, and booking/claim RPCs are service-role-only. These exceptions protect invariants instead of treating every row as freely editable.

The server’s service-role client bypasses RLS. That is why every public repository operation is scoped using validated clinic/conversation context. Admin routes first validate the JWT with `auth.getUser`, then look up the staff clinic; they ignore clinic selection supplied by the browser. Tenant boundaries are tested both in the API and with actual PostgreSQL policies.

Source: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## How does mock mode work?

`MOCK_LLM=true` selects a deterministic provider implementing the same `embed` and `complete` interface as the official OpenAI adapter. It returns scripted function calls: questions search documents, appointment enquiries fetch slots, structured booking details prepare review, confirmation books the stored proposal, enquiries create leads and human requests flag follow-up. The fake reads real tool results before replying, so tools and persistence are exercised.

Mock embeddings are normalized 1536-element word-hash vectors. The in-memory test/demo repository also requires lexical overlap to avoid treating a hash collision as a meaningful answer. This is a deterministic testing technique, not semantic embedding quality. In Supabase mock mode the same fake vectors use the real SQL search. Regenerate all document embeddings whenever switching between mock and live models.

`DEMO_MODE=true` is separate: it selects a volatile auto-seeded memory repository and a local demo staff token. It is forbidden with `NODE_ENV=production`. Tests use mock AI with fresh memory repositories, execute SQL against test-only PostgreSQL/pgvector, and test real SDK adapters using fake HTTP transports. Production always uses Supabase storage.

## How does email and reminder automation work?

Booking queues a confirmation in the same transaction as the appointment. The request then tries to deliver it. A failure leaves the appointment confirmed and the email queued; the reply reports delivery state rather than pretending that mail was sent.

The hourly GitHub Actions workflow calls `POST /api/jobs/send-reminders` with `x-cron-secret`. The API compares hashed secrets in constant time. `enqueue_reminders` finds confirmed appointments 23–25 hours away with no reminder timestamp, then inserts one unique `(appointment_id, kind)` outbox row. The job also retries confirmations.

`claim_emails` uses `FOR UPDATE SKIP LOCKED` and a five-minute lease so overlapping workers do not normally claim the same row. Delivery uses a stable Resend idempotency key based on the outbox ID. After acceptance, `complete_email` verifies the claim token, records `sent_at` and, for reminders, sets `reminder_sent_at`. Failure releases the claim for retry; an abandoned claim expires. A cancelled appointment is suppressed when processing its queued email.

Resend’s idempotency window is finite, and an email provider is outside the database transaction. This is durable, idempotent retry behavior within that window, not unconditional exactly-once delivery. The job claims at most 50 rows per request; larger clinics need a dedicated worker/queue and monitored delivery backlog. The console fallback previews mail and counts it as processed without sending externally.

## How are costs and dashboard numbers computed?

Every completion and retrieval embedding has a usage row tied to its conversation. Mock calls have zero provider tokens/cost. Live costs use environment-supplied USD-per-million rates; all rates must be configured before the dashboard presents an estimate as configured. This avoids silently assuming a price for a different model.

`usage_summary` aggregates all history for the verified clinic in SQL, not a capped first page of rows. It returns tokens, cost, average latency and model-call count; the chart covers the last 30 days using Asia/Karachi dates. “Requests” in that chart means model/embedding calls, not patient messages. Estimates exclude provider billing adjustments and infrastructure.

## What would you change at larger scale?

Start with a shared rate limiter, durable background workers, a separate conversation capability and stronger patient authentication. Add clinical safety evaluations, a document ingestion/versioning flow, scheduling/calendar integrations, data retention controls and operational metrics for the outbox. Measure live-provider latency separately from local mock throughput. These changes respond to a demonstrated scale or privacy need; they are intentionally outside this small-clinic portfolio’s scope.
