# ClinicDesk AI

Use Node 20 and npm workspaces. Keep server logic in `server/src`, clinic SQL in `supabase/migrations`, and React/CSS modules in `web/src`. Never edit secrets into tracked files.

Before committing changes, run `npm run lint`, `npm run typecheck`, `npm run test:coverage`, and `npm run build`. Server tests must use MOCK_LLM=true and keep at least 80% line coverage. Database tests execute migrations using a test-only PostgreSQL/pgvector runtime; they do not connect to a cloud clinic. New migrations must keep RLS enabled and public endpoints must derive all data access from their validated clinic/conversation context. Staff membership must never be self-editable.

Use explicit booking confirmation, atomic slot booking, and the email outbox for all appointment notifications. Preserve no-account demo mode as local-only. Document material limitations and do not invent load-test results or hosted URLs.
