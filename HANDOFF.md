# Oniro Dev handoff

## Start here

Oniro Dev is a Messenger-first shared inbox for Philippine small businesses. The repository is [thekirx/kunek](https://github.com/thekirx/kunek), and the Phase 2 baseline is [`6bc5b66`](https://github.com/thekirx/kunek/commit/6bc5b66018093b6246000488314e751b48113ba1) on `main`. In the original Codex Cloud chat the checkout was `/workspace/kunek`. Use the actual checkout path in a new environment.

- Read the [README](README.md) for installation, Supabase setup, and the exact Meta setup.
- Read the [change log](CHANGELOG.md) for the Phase 1 and Phase 2 scope and commit history.
- Read the [verification log](docs/VERIFICATION.md) for reproducible checks, past failures and fixes, and the live acceptance checklist.

Run `git status --short --branch` and inspect the current diff before editing. Keep the existing inbox and retain the original schema when adding new functionality. Read [AGENTS.md](AGENTS.md) and the installed Next.js guides before changing framework entry points.

## Current status

| Area | State |
| --- | --- |
| Source control | Phase 1 and Phase 2 were pushed and verified on GitHub. |
| Demo | `/demo` runs without provider credentials and resets its fixture data on reload. |
| Database-backed app | Signup, login, logout, workspace creation, invitation acceptance, tenant-scoped inbox, and signed webhook persistence passed local integration testing. |
| Hosted Supabase | The owner supplied a project URL in the original chat. Credentials, migration application, Auth settings, and the project’s intended use remain unverified. The original Codex Cloud file panel could not edit the private environment file, and the owner's desktop UI did not expose a Desktop tab. |
| Meta | The OAuth and Messenger API paths are implemented. No real Page round trip or live delivery state has been verified. |
| Realtime | Publication and client subscriptions are implemented with a visibility-aware polling fallback. Live WebSocket delivery remains unverified. |
| Deployment | No staging or production deployment was performed during Phase 2. A stable HTTPS origin is needed for the real Meta test. |

Use the supplied project URL from the owner’s secure configuration. If editing `.env.local` is unavailable, use the cloud environment’s managed variables and secret settings. A republished environment applies to future chats, while the running chat may offer its own apply controls. Keep the Supabase secret key and all Meta secrets server-side. [Codex Cloud credential setup](https://learn.chatgpt.com/docs/environments/cloud-environments#configure-environment-variables-and-network-secrets)

## Where to work

| Area | Entry points |
| --- | --- |
| Next.js routes and screens | [Demo](src/app/demo/page.tsx), [workspace selector](src/app/workspace/page.tsx), [live inbox](src/app/workspace/%5BorganizationId%5D/page.tsx), [Page management](src/app/workspace/%5BorganizationId%5D/channels/page.tsx), [team invitations](src/app/workspace/%5BorganizationId%5D/team/page.tsx) |
| Auth and tenancy | [Session refresh proxy](src/proxy.ts), [Supabase clients](src/lib/supabase/server.ts), [verified session and membership](src/lib/supabase/access.ts), [credential handlers](src/lib/supabase/auth-actions.ts) |
| Inbox | [Shared dashboard](src/components/inbox.tsx), [live refresh and mutations](src/components/inbox-live.tsx), [snapshot query and mapping](src/lib/inbox/snapshot.ts), [inbox API](src/app/api/inbox/route.ts) |
| Meta OAuth and Page lifecycle | [Start](src/app/api/meta/oauth/start/route.ts), [callback](src/app/api/meta/oauth/callback/route.ts), [connect and disconnect](src/app/api/meta/channels/route.ts), [Graph API client](src/lib/meta/graph.ts) |
| Messenger ingest and send | [Webhook](src/app/api/meta/webhook/route.ts), [event parsing](src/lib/meta/events.ts), [reply coordination](src/lib/meta/reply.ts), [profile enrichment](src/lib/meta/profile.ts) |
| Database and tests | [Migrations](supabase/migrations/), [SQL suites](tests/db/), [Node tests](tests/) |

The application uses Next.js App Router, React, TypeScript, Supabase SSR and PostgREST, and PostgreSQL. Use Node.js 24 or newer and the npm lockfile. The public key and URL can reach the browser. The server key bypasses RLS and belongs only in server configuration, behind routes that verify the actor and workspace. [Environment template](.env.example)

## Contracts to preserve

- Session reads use the current user and organization membership. Privileged SQL functions accept a verified actor and repeat the relevant authorization checks. Composite foreign keys tie related records to the same organization and Page. Apply changes as new migrations.
- OAuth state binds the actor, organization, browser nonce, and expiry. The callback consumes the nonce once. Page candidates and encrypted credentials stay in `oniro_private`, which should remain outside Data API exposure.
- The webhook validates the HMAC over the raw body. It acknowledges supported events only after durable database processing. Missing storage or failed persistence returns a retriable HTTP 503. Page-scoped message and event identifiers prevent replay from producing duplicate records.
- A reply reserves its request ID before calling Meta. The 24-hour reply window is enforced in SQL. A timed-out or uncertain send stays unconfirmed, and retrying with the same ID does not call Meta again. A matching echo can reconcile it. Show sent, delivered, and read as separate states.
- The inbox loads up to 75 recent conversations and up to 100 recent messages and notes per conversation. Its analytics cover the loaded data. History import, attachment sending, and billing remain outside the shipped scope.

## Next work in dependency order

1. Confirm the owner’s intended Supabase project and approval to migrate it. Add the environment values securely and verify that the app can use the publishable and server keys. Apply the existing migrations in order to the approved development project and configure email/password Auth, the site URL, and the confirmation redirect.
2. Choose an approved HTTPS development or staging origin. Confirm signup and sign-in through that origin. Use the [live acceptance checklist](docs/VERIFICATION.md) to prove tenant isolation and Realtime against the configured project.
3. Configure a Meta app and connect an authorized development Page using the [Meta setup](README.md#connect-your-first-real-facebook-page). Verify a real inbound message and a reply received in Messenger before reporting live readiness.
4. Record which environment was verified, which checks passed, and what failed in the [verification log](docs/VERIFICATION.md). Keep customer message bodies, tokens, invite URLs, and credentials out of logs and commits.

Do not modify real Facebook Pages or deploy production infrastructure without the owner’s approval. Keep the test project and Page separate from customer-facing resources.
