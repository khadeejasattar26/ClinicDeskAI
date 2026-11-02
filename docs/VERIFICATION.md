# Verification record

Date: 2 November 2026. Runtime: Node.js 20.20.2 on macOS arm64. No real clinic data, API keys or emails were used.

## Passed locally

- Every milestone ran the applicable tests before its Git commit; the detailed counts are in `MILESTONES.md`.
- Clean lockfile install (`npm ci`), final lint, both workspace TypeScript checks and both production builds.
- **68 Jest/Supertest tests** across eight suites, with **97.16% server line coverage**. The coverage set includes every file in `server/src`, including the process launcher. The threshold is 80%.
- **7 Vitest/React Testing Library tests** for patient chat, booking review/confirmation, network errors, admin access, appointments, usage/chart, transcripts and sign-in error handling.
- Real PostgreSQL/pgvector migration execution using test-only PGlite, with Auth schema/roles stubbed for the tests. Assertions cover RLS on all ten application tables, staff clinic isolation, blocked membership escalation, anonymous denial, scoped vector retrieval, atomic duplicate-slot booking, email claims and SQL usage aggregation.
- Supabase and OpenAI SDK adapters exercised with fake HTTP transports. Resend exercised with a fake client. These verify request scoping, tool/usage mapping and idempotency options; they do not establish live provider availability.
- Native Safari rendered the clinic page and login screen; a chat quick reply returned a sourced answer from the real local API. The local demo staff session opened the dashboard.
- k6 1.8.2 completed a **0→50 VU, 60-second** scenario against the compiled mock API. **2,981 requests; health p95 1.53ms; chat p95 2.24ms; overall HTTP p95 2.07ms; 0% application and HTTP errors.** All four configured thresholds passed. `load/benchmark.json` stores the reviewed numbers and exact conditions.
- `npm audit --omit=dev`: zero advisories in production dependencies at verification time.
- A clean copy was pruned with `npm prune --omit=dev`; the compiled API then started in production mode and passed an HTTP health check using placeholder credentials without calling external services. All YAML manifests parsed, and `docker compose config --quiet` passed.

## Known verification limits

- Docker Desktop's daemon was unavailable. The Dockerfile was reviewed and the production Node build exercised; a Docker image build/start was not performed. A plain PostgreSQL server would not be an adequate substitute for testing Supabase Auth/PostgREST behavior.
- Supabase cloud migrations, the live seed, live staff sign-in, real OpenAI embeddings/completions and Resend delivery need account credentials and were not called. The default demo seed command was executed successfully. The SQL tests cover PostgreSQL behavior but are not a deployed Supabase acceptance test.
- GitHub workflows and Render resources were authored locally; they have not run in the user's remote accounts. No remote repo, paid cloud resources, email sends or public deployment were created.
- Responsive layouts were implemented and component flows tested. A physical mobile device / browser-emulation sweep was not available through the native UI surface; mobile visual acceptance remains a deployment check.
- The k6 result uses local mock AI and volatile memory storage. It does not predict live model or database latency, horizontal scaling, or hosted capacity.
- Coverage counts executable lines; it does not prove clinical safety, model truthfulness, adversarial prompt-injection resistance or correct provider billing. Guardrails are deliberately documented without claiming those guarantees.

## Remaining development dependency advisories

The final full-tree audit reports **20 affected development dependency entries: 17 moderate and 3 low**, with no high or critical findings. These entries are in the Jest / coverage dependency graph; the count includes propagated affected parent packages, not twenty separate root vulnerabilities.

The underlying reports are:

- [deepmerge prototype poisoning](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), low, through Jest configuration.
- [glob cancellation bypass](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), moderate, through Jest/coverage filesystem traversal.
- [minimatch globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249), moderate, in transitive test tooling.

High/critical findings in older zod and test-worker packages were removed, and compatible validator, mailer, lint and test patches were applied. `npm audit fix --force` suggests incompatible/downgraded tooling for the remaining graph, so it was not used. Run tests only on trusted local project inputs and update the tooling when compatible upstream fixes are available. Runtime Docker dependencies are pruned with `--omit=dev`.
