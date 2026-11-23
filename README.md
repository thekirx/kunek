# Oniro Dev

Oniro Dev is a Messenger-first shared inbox for Philippine small businesses. This repository contains the Phase 1 workspace demo and the database and Meta integration foundations.

## Run the demo

Use Node.js 24 or newer and npm. In the Codex Cloud workspace, run these commands from `/workspace/kunek`.

```sh
npm ci
npm run dev
```

Open [the local app](http://localhost:3000). The **Demo workspace** uses fictional customers and Pages. Search and filter conversations, send a demo reply, add a private note, assign an agent, edit tags, change lead and conversation status, and switch to dark mode. Customers, Team, Analytics, and Settings use the same sample workspace. Reloading restores the default fixture. Demo replies stay in the browser.

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

## Project layout

| Path | Purpose |
| --- | --- |
| `src/app` | Next.js App Router, workspace entry point, CSS theme, and Meta webhook |
| `src/components` | Inbox panes, workspace views, and shadcn/ui primitives |
| `src/lib/inbox` | Typed demo workspace and sample conversation data |
| `src/lib/meta` | Webhook validation, OAuth state and authorization URL helpers, and encrypted token envelopes |
| `supabase/migrations` | PostgreSQL schema, constraints, RLS, grants, and subscription tiers |
| `tests` | Signed webhook fixture, server helper tests, and SQL isolation assertions |

The inbox keeps demo changes in React state. Supabase tables use tenant-scoped composite foreign keys for conversations, contacts, and related entities. RLS uses organization memberships for reads and manager roles for invitation and audit data. Authenticated clients have read grants. Future server writes need session and role checks before using privileged database access. Page credentials live in a private schema and are encrypted in the application using AES-256-GCM.

Starter, Growth, and Pro have the proposal's Page and staff limits and PHP prices. The migration seeds plan definitions and defaults subscription records to unpaid. Entitlement enforcement and billing are deferred.

## Environment configuration

The demo needs no environment variables. To exercise the webhook locally or prepare for later provider setup, copy `.env.example` to `.env.local`. Keep real credentials in local or host environment configuration.

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL for Phase 2 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key for Phase 2 |
| `META_APP_ID`, `META_APP_SECRET` | Meta App Dashboard → App settings → Basic. The secret verifies webhook signatures |
| `META_WEBHOOK_VERIFY_TOKEN` | Random string you generate and enter in both the app environment and the Meta webhook form |
| `META_GRAPH_API_VERSION` | Version in `vN.N` format, chosen from the Meta app's supported Graph API versions |
| `META_OAUTH_REDIRECT_URI` | Exact HTTPS callback URI for the future OAuth route |
| `META_OAUTH_SCOPES`, `META_LOGIN_CONFIG_ID` | Comma-separated permissions for a scope-based flow, or the ID for a configured Facebook Login for Business flow |
| `META_OAUTH_STATE_SECRET` | Random HMAC secret for the future OAuth routes |
| `META_PAGE_TOKEN_KEY` | Base64 representation of 32 random bytes for Page-token encryption |

Generate a state secret or verification token with `openssl rand -hex 32` and a Page-token key with `openssl rand -base64 32`. Use different values for each purpose. Keep Supabase service-role credentials server-only when Phase 2 adds them.

## Supabase setup

1. Install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) and start Docker to use a local, free development stack. From the repository root, run `supabase init` once if `supabase/config.toml` does not exist, then `supabase start`.
2. Apply the checked-in migration to the local stack with `supabase db reset --local`. This resets the local development database. Use a fresh development project if using a hosted database.
3. Copy the local URL and publishable key shown by `supabase status` into `.env.local`. These will be used when the Phase 2 auth and database adapters are implemented.
4. Run `psql "$ONIRO_DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/db/tenant-isolation.sql` with the development database connection string from `supabase status`. The assertions run in a transaction and roll back their fixture data.

Email/password auth, organization creation, staff invitations, authorized write operations, and Realtime subscriptions are Phase 2 and later work. Apply the migration only to an approved project. The browser demo continues to use fixtures after the migration is applied.

## Meta setup and webhook

### Verify the webhook locally

Set `META_WEBHOOK_VERIFY_TOKEN` and `META_APP_SECRET` in `.env.local`, then restart the dev server.

```sh
curl --get 'http://localhost:3000/api/meta/webhook' \
  --data-urlencode 'hub.mode=subscribe' \
  --data-urlencode 'hub.challenge=42' \
  --data-urlencode "hub.verify_token=${META_WEBHOOK_VERIFY_TOKEN}"
```

Export the same verification token in your shell before running the command. A matching token returns `42`. The POST route validates `X-Hub-Signature-256` over the raw bytes, validates the Page envelope, ignores echoes, and deduplicates message IDs within the same delivery. The schema also has a unique constraint for Page-scoped message IDs. Valid incoming messages receive HTTP 503 so Meta can retry while persistence is unavailable.

### Connect an authorized development Page during Phase 3

1. In [Meta for Developers](https://developers.facebook.com/apps/), create or select an app whose use case supports Messenger for business Pages. Add Messenger and configure the appropriate Meta login flow for that app. Add the test account to the app's roles and grant that account access to the test Facebook Page.
2. Copy the App ID and App Secret from App settings. In the login product, configure the exact **Valid OAuth Redirect URI** after the callback is implemented. If using Facebook Login for Business, create a login configuration and copy its ID. Confirm the scopes for your flow with Meta's current docs. Common Messenger permissions include `pages_messaging`, `pages_show_list`, and `pages_manage_metadata`.
3. After message persistence is working, expose an approved staging instance over HTTPS. In the Messenger webhook configuration, enter `https://<staging-host>/api/meta/webhook` and the verification token. Subscribe to the Page `messages` field and subscribe the authorized test Page to the app.
4. Send and reply to a test message with an authorized account. Check Page routing, duplicate delivery, retry behavior, and the permitted messaging window. Complete Meta App Review and any required Advanced Access or Business Verification before connecting businesses outside the app's test roles.

Phase 1 includes OAuth state signing and verification, authorization URL construction, and encrypted Page-token helpers. The OAuth start and callback routes, token exchange, Page connection controls, database-backed webhook processing, and outgoing Messenger replies are deferred. No live Page was connected or tested. [Messenger overview](https://developers.facebook.com/docs/messenger-platform/) · [Webhooks](https://developers.facebook.com/docs/messenger-platform/webhooks/)

## Next development phase

1. Apply and verify the migration in a local Supabase stack.
2. Implement Supabase session handling and organization creation with an atomic owner membership insert. Add authorized writes and test with two signed-in users.
3. Wire the Meta authorization routes to a verified owner or admin, consume the OAuth nonce once, and connect test Page persistence before subscribing the Page. Use transactional idempotency and enforce Meta's messaging window on outgoing replies.
4. Replace the fixtures with tenant-scoped database records and add Realtime. Implement team invitations, entitlement enforcement, and verified analytics for real records.

Local development can use free tools and plans. Before commercial deployment, check the host's commercial-use terms. Vercel Hobby is for personal, non-commercial use, so budget for a commercial hosting plan if using Vercel for the commercial app. Supabase usage, transactional email, and operational needs can add costs as usage grows. [Vercel Hobby terms](https://vercel.com/docs/plans/hobby) · [Supabase pricing](https://supabase.com/pricing)
