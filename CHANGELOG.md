# Change log

## Phase 2 · November 24, 2026 · Manila

[Commit `6bc5b66`](https://github.com/thekirx/kunek/commit/6bc5b66018093b6246000488314e751b48113ba1) · pushed to `main`

- Added Supabase SSR authentication, protected workspaces, organization creation, and expiring email-bound invitation links.
- Connected the existing inbox layout to a tenant-scoped database snapshot. Added live mutations for replies, notes, assignments, tags, status, lead stage, and read state. Kept the independently runnable demo.
- Added Meta OAuth with single-use state, authorized Page selection, encrypted Page credentials, and recorded Page-operation state. Connected and disconnected Pages only after confirmed provider responses.
- Replaced webhook scaffolding with signed batch ingestion, Page routing, replay-safe inbound persistence, and echo and receipt handling. Added optional post-acknowledgment profile-name enrichment.
- Added outgoing reply reservations, 24-hour window enforcement, and honest status reporting for confirmed and ambiguous outcomes.
- Added Realtime subscriptions with polling fallback. Updated the environment template and provider setup instructions. Added Graph API and database regression tests.

| Migration | Purpose |
| --- | --- |
| [`202611230002_phase2.sql`](supabase/migrations/202611230002_phase2.sql) | Organization bootstrap, channel operations, Messenger persistence and receipts, outgoing reservations, inbox mutations, and Realtime publication |
| [`202611230003_oauth_invitations.sql`](supabase/migrations/202611230003_oauth_invitations.sql) | Private OAuth attempts and Page candidates, invite creation and acceptance, and confirmed-email checks |
| [`202611230004_messenger_batches.sql`](supabase/migrations/202611230004_messenger_batches.sql) | Transactional batch ingest and service-only profile enrichment context |

## Phase 1 · November 23, 2026 · Manila

[Commit `9754b88`](https://github.com/thekirx/kunek/commit/9754b88) · pushed to `main`

- Built the credential-free demo workspace with the shared inbox, light and dark themes, and responsive layouts.
- Added the initial Supabase schema, RLS, organization roles, subscription plan definitions, and tenant isolation tests. [Initial migration](supabase/migrations/202611230001_initial_schema.sql)
- Added the initial Meta webhook signature and OAuth state helpers, local fixtures, and setup instructions.
