# Verification log

## Last verified published baseline

The last full check of the published code was for [Phase 2 commit `6bc5b66`](https://github.com/thekirx/kunek/commit/6bc5b66018093b6246000488314e751b48113ba1). GitHub’s `main` was verified to point to this commit after the push.

| Check | Result and scope |
| --- | --- |
| Lint, typecheck, production build | Passed. These checks ran again immediately before the Phase 2 push. |
| Node test suite | 24 passed. Covers signed webhooks, OAuth state, token encryption, Meta paging, Page identity, permission errors, delivery parsing, and ambiguous sends. Graph tests use fixtures. |
| PostgreSQL suites | Three passed against a disposable PostgreSQL 17 database with Supabase auth roles and migrations applied. Covers RLS, cross-tenant writes and sends, expired reply windows, replay, receipt ordering, OAuth consumption, and invitations. |
| Browser and API smoke test | Passed against local Supabase Auth, PostgreSQL, and PostgREST. Covered signup, workspace creation, invite acceptance, cross-tenant denial, sign-out and sign-in, and demo isolation. A signed synthetic webhook produced one stored message across two deliveries. |
| Responsive UI | Desktop and mobile browser checks passed against fixture API responses. Covered draft preservation, simulated send states, notes, and mobile pane navigation. |
| Hosted Supabase, live Meta, and Realtime delivery | Pending. Local email confirmation was bypassed in the smoke setup. A hosted confirmation email, live Realtime events, and a real Messenger round trip still need to be tested. |

## Unreleased Messenger reliability verification

Lint, typecheck, production build, and all 25 Node tests passed. All five migrations and four SQL suites passed on a disposable PostgreSQL 17 database with Supabase auth roles. The new tests exercise historical and duplicate deliveries, resolved conversation reopening, bounded future timestamps, and a mixed valid and malformed webhook batch.

## Reproduce checked-in tests

The commands below need Node.js 24 or newer. They can run without hosted Supabase or Meta credentials.

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

For the SQL suites, point `ONIRO_DEV_DATABASE_URL` at a disposable development database after applying all migrations. The suites roll back their own fixtures. Use the [README’s Supabase setup](../README.md#configure-supabase) to start a local stack.

```sh
for file in tests/db/tenant-isolation.sql tests/db/phase2.sql tests/db/oauth-invitations.sql tests/db/messenger-reliability.sql; do
  psql "$ONIRO_DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file" || exit 1
done
```

The browser integration smoke harness was temporary. The checked-in Node and SQL tests are the repeatable automated suites. [Node tests](../tests/) · [SQL suites](../tests/db/)

## Live acceptance checklist

- [ ] Confirm that all migrations are applied to the approved Supabase development project. Test that the server can load a workspace without exposing any server keys to the browser.
- [ ] Sign up through the approved app origin and follow the actual confirmation email in the same browser. Verify sign-in, workspace creation, invitation acceptance, and sign-out.
- [ ] Use two independent organizations to verify that members cannot read or mutate a different workspace. Verify that a second authorized client receives an inbox change through Realtime before the 20-second polling refresh.
- [ ] Complete Meta OAuth as an owner or admin and confirm the authorized development Page shows **Connected**.
- [ ] Send a message from an authorized Messenger test account and verify it reaches the intended workspace exactly once. Reply inside Meta’s 24-hour window and confirm the reply appears in Messenger. Verify delivery and read transitions if Meta emits those events.
- [ ] Verify reconnect and disconnect on the authorized test Page. Confirm that an expired or rejected token and a disconnected Page each produce an accurate error.

## Troubleshooting notes

| Symptom | Check first |
| --- | --- |
| Local signup form returns HTTP 403 while a direct request succeeds | Match `ONIRO_APP_URL` to the browser origin. The app uses `Referrer-Policy: same-origin` so native same-origin forms preserve an Origin header. A global `no-referrer` policy caused local browser form submissions to fail during Phase 2 verification. |
| App opens in demo or sign-in says configuration is missing | Verify the project URL and publishable key are available to the current runtime, then restart it. The browser build gets `NEXT_PUBLIC_*` variables at build time. The app reads the server key separately for privileged operations. |
| Browser flow is blocked by a read-only file panel | Use the managed Cloud environment configuration or a local editor in a workspace that supports one. Put the keys in the secure settings, then verify variable presence without printing values. |
| Supabase CLI cannot start in this Cloud environment | CLI v3 tried to write under the read-only home directory. The full Docker stack also exceeded the test machine’s disk space. The Phase 2 smoke test used disposable Auth, PostgREST, and PostgreSQL containers. A normal local Supabase stack or approved development project is suitable for the live checklist. |
| Signed webhook returns HTTP 503 | Check server configuration, project connectivity, migration order, and execution of the service-only batch ingest RPC. Keep storage failures retriable. |
| Reply remains unconfirmed | Check stored status and Meta’s echo before trying again. Reusing the original request ID cannot send a second copy. Do not mark it sent or delivered without evidence. |
| Page connection stays in **Needs attention** | Review the Phase 2 lease behavior and the credential’s Page identity. Check Meta’s actual outcome before reconnecting or disconnecting again. |
