# Oniro Dev

Oniro Dev is a Messenger-first shared inbox for Philippine small businesses. The app provides a protected Supabase workspace and a separate demo. Pages are connected through Meta OAuth by an organization owner or admin.

For engineering handoff, see the [handoff guide](HANDOFF.md), [change log](CHANGELOG.md), and [verification log](docs/VERIFICATION.md).

## Run the app

Use Node.js 24 or newer.

```sh
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). With Supabase configured, the entry point leads to your workspaces. [The demo](http://localhost:3000/demo) runs without credentials, never reads the live database, and resets its sample data on reload.

## Configure Supabase

1. Create a dedicated development project or install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) and Docker. From this checkout, run `supabase init` once if `supabase/config.toml` is absent. Start the local stack with `supabase start` and apply all migrations with `supabase db reset --local`. This resets the local database. For an approved hosted development project, link it using `supabase link --project-ref YOUR_PROJECT_REF`, review all migrations, then apply them with `supabase db push --linked`.
2. Copy `.env.example` to `.env.local`. Set `ONIRO_APP_URL=http://localhost:3000` for local development or the approved HTTPS origin for a test instance. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the project's Connect dialog or `supabase status`. Set the server-only `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` from the same project. Keep all secrets in your development or hosting secret store.
3. Under **Authentication → Providers**, enable email/password signup. Under **Authentication → URL Configuration**, set the Site URL to `ONIRO_APP_URL` and add the exact `<origin>/auth/confirm` redirect. For invitations to new users, also allow the same confirmation route with its query string if your redirect rules require it. Use the default confirmation email template and open its link in the same browser used to sign up. A local stack captures those emails in Mailpit. Configure an approved SMTP sender for hosted customer signups.
4. In the project's Data API settings keep the `public` schema available and keep `oniro_private` out of exposed schemas. Confirm the `supabase_realtime` publication includes the workspace tables from the Phase 2 migrations. Use a fresh signing session after changing configuration.
5. Restart the app, open `/signup`, confirm your email, and sign in. Create a workspace. Owners and admins can make invitation links under **Team**. Share a link with the intended teammate, who signs in using the verified invited email to accept it. Invitations are single-use and expire after two days.

The runtime uses Supabase SSR cookies, verified users and membership checks, RLS for session reads, and scoped service-only SQL functions for privileged actions. Subscription records start as unpaid; billing is outside this phase.

## Connect your first real Facebook Page

Use a Page you own or have permission to manage and an approved HTTPS development or staging origin. A localhost-only app can test the inbox with fixtures but cannot receive Meta webhook deliveries.

1. In [Meta for Developers → My Apps](https://developers.facebook.com/apps/), create or select a business app with a use case that supports **Messenger**. Add the Messenger product and the Meta login product available for the app. Add your test Facebook account under **App roles** and confirm it can manage and message on the test Page in Meta Business Suite.
2. In **App settings → Basic**, copy **App ID** and **App Secret** into server-only `META_APP_ID` and `META_APP_SECRET`. Set `META_GRAPH_API_VERSION` to a supported version shown by the app (format `vN.N`).
3. In the login product's **Settings → Valid OAuth Redirect URIs**, add exactly `https://YOUR_DEV_HOST/api/meta/oauth/callback`. Set the identical URL as `META_OAUTH_REDIRECT_URI` and set `ONIRO_APP_URL=https://YOUR_DEV_HOST`. If using **Facebook Login for Business**, configure a login configuration that uses a user access token, includes Pages as assets, and grants `pages_show_list`, `pages_messaging`, and `pages_manage_metadata`. Set `META_LOGIN_CONFIG_ID` to that configuration ID. The alternate scope-based flow requests those three permissions directly.
4. Generate three independent server values. Use `openssl rand -hex 32` for each of `META_WEBHOOK_VERIFY_TOKEN` and `META_OAUTH_STATE_SECRET`, and `openssl rand -base64 32` for `META_PAGE_TOKEN_KEY`. Keep the Page token encryption key backed up securely. Replacing it without migrating ciphertext requires a Page reconnect.
5. In **Messenger → Settings → Webhooks** (or **Webhooks → Page**, depending on the app UI), add callback URL `https://YOUR_DEV_HOST/api/meta/webhook` and the identical verification token. Configure Page fields for messages, echoes, deliveries, and reads. The Page `subscribed_apps` request uses the Graph field names `messages`, `message_echoes`, `message_deliveries`, and `message_reads`. It runs only when a workspace manager confirms **Connect Page**.
6. Sign in to Oniro as the workspace owner or admin. Open **Settings → Manage Facebook Pages → Authorize with Meta**. Continue as the test account, grant access to the test Page, select it in Oniro, and choose **Connect Page**. Confirm the Page reads **Connected**. To reconnect an expired token, repeat authorization and select the same Page. Disconnect removes this app's subscription and deletes the stored Page credential once Meta confirms.
7. From an authorized test account, send a new message to the Page. Check that exactly one conversation appears. Reply in Oniro within 24 hours of the customer's message and verify the reply in Messenger. Confirm receipt state when Meta reports it. This is the live verification step. Before onboarding businesses outside the app's roles, complete Meta's requested **App Review**, **Advanced Access**, and **Business Verification**, then confirm the app mode and approved permissions.

[Messenger Platform](https://developers.facebook.com/docs/messenger-platform/) · [Meta login manual flow](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/) · [Page subscription reference](https://developers.facebook.com/docs/graph-api/reference/page/subscribed_apps/)

## Delivery and inbox behavior

- The webhook verifies the challenge and raw-body HMAC before parsing. It routes by the connected Page, stores each supported event transactionally, and acknowledges after durable processing. On a storage failure it returns HTTP 503 so Meta can retry. Replay and delivery receipts are processed idempotently. Malformed event records are skipped within a valid batch, and a newly stored customer message can reopen a resolved conversation.
- Replies use the standard 24-hour Messenger response window, a durable request ID, and Meta's RESPONSE send type. Reservation allows one minute of clock skew for a customer timestamp ahead of the database clock. An API acknowledgment is shown as sent. Delivered and read states come from Meta events. If a send might have succeeded, the reply stays unconfirmed and retries with the same request ID never resubmit it to Meta. A corresponding Meta message echo can reconcile it.
- The live inbox displays the 75 most recent conversations with up to 100 recent messages and notes per conversation. Analytics reflect the loaded records. The Composer sends text. Non-text inbound messages are represented as unsupported attachments. Page-scoped customer IDs are stored, and a profile name is fetched when Meta allows it, with a generic display name otherwise. History import and attachment sending are outside this phase.
- Supabase Realtime triggers a fresh tenant-scoped read. The browser also refreshes periodically and when brought to the foreground. The demo uses local React state only.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

To run the SQL suites, use an empty development stack with the migrations applied and set `ONIRO_DEV_DATABASE_URL` from `supabase status`.

```sh
for file in tests/db/tenant-isolation.sql tests/db/phase2.sql tests/db/oauth-invitations.sql tests/db/messenger-reliability.sql; do
  psql "$ONIRO_DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file" || exit 1
done
```

The SQL tests run inside rollback transactions. Offline tests use synthetic Meta responses and do not call live Pages. No live Messenger round trip has been verified as part of this implementation.

Local development can use free tools and plans. Before commercial deployment, check the host's commercial-use terms and plan for hosting, SMTP, and usage costs. [Vercel Hobby terms](https://vercel.com/docs/plans/hobby) · [Supabase pricing](https://supabase.com/pricing)
