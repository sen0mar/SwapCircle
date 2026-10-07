# SwapCircle

A pnpm workspace with React, Express, shared API contracts, and a server-only Drizzle database package.

Use Node **24.13.0** (also pinned in `.node-version`) and pnpm **11.5.3**.

```sh
pnpm install --frozen-lockfile
pnpm --filter @swapcircle/contracts build
pnpm dev
```

Open the Vite URL printed in the terminal. Home (`/`), Browse (`/browse`), and unknown-path recovery work without credentials or external services. Browse is a placeholder until the catalog is implemented.

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

CI runs the commands above in that order, followed by:

```sh
pnpm --filter @swapcircle/web exec playwright install --with-deps chromium
pnpm test:browser
```

Vitest runs typed Supertest API tests and React Testing Library component tests with MSW network handlers. Existing Node regression tests remain alongside them. MSW runs only in tests; its optional worker installation script is disabled. Playwright covers the Home/theme/navigation/drawer smoke, accessibility, production exclusions, and real Express stop/restart recovery. Unit/browser tests use synthetic data and local services; database verification runs separately against isolated local Supabase. GitHub Actions runs on pushes and pull requests with read-only repository permission and no deployments.

- `apps/web`: browser UI; only browser-safe dependencies belong here.
- `apps/api`: Express app factory and separate listening process.
- `packages/contracts`: browser-safe Zod API contracts.
- `packages/database`: Drizzle schema/migrations, bounded PostgreSQL pools, and local database tooling.

Dependencies must be declared in their consuming package. Server packages expose only a Node export condition, and lint rejects server-package imports from web code. There are no workspace-wide source aliases. TypeScript uses Bundler resolution for Vite and NodeNext for Node packages.

For the development API status view at `/dev/api-status`, run in a second terminal:

```sh
cp apps/api/.env.example apps/api/.env
pnpm --filter @swapcircle/api dev
```

After `pnpm db:setup`, copy the generated local `DATABASE_URL` from
`packages/database/.env` into the ignored `apps/api/.env`. Keep this server-only
connection string out of `VITE_*` settings and commits.

The default web origin is `http://127.0.0.1:5173`. `CORS_ORIGINS` is required: a comma-separated list of exact HTTP(S) origins without paths or trailing slashes. `PORT` defaults to 3001. Invalid settings fail startup without printing their values. The API dev command compiles before starting; rerun it after TypeScript changes. For compiled operation use `pnpm --filter @swapcircle/api start`.

`VITE_API_URL` is the public API origin (default `http://127.0.0.1:3001`); use `apps/web/.env.example` when overriding it. `/api/v1/live` reports process liveness only. This endpoint does not check database readiness or authentication. JSON bodies are limited to 16 KiB. CORS is browser access control, not authorization.

The development status page uses TanStack Query and native fetch, supports cancellation and a 15-second timeout, and retries only on request. It is omitted from production builds. `pnpm --filter @swapcircle/web test:browser` verifies browser behavior including stopping/restarting an isolated API on port 4311; ports 4173/4174 must also be available. No credentials are needed. Keep credentials out of browser code and out of Git. The architecture and UI references remain in `context/`.

## Local database

Docker must be running. The pinned Supabase CLI creates project `swapcircle-local`
on ports 55430–55434, separate from hosted projects and other local stacks.
Run from the repository root:

```sh
pnpm db:start
pnpm db:setup
pnpm db:reset
```

`db:setup` captures local CLI credentials without printing them and writes a
Git-ignored, owner-readable `packages/database/.env`. It refuses to overwrite an
existing file. `.env.example` documents variable names with empty secret values.
`MIGRATION_DATABASE_URL` uses the local schema owner; `DATABASE_URL` uses a separate
random-password `swapcircle_runtime` role. Never copy either to a `VITE_*` variable.
The API uses this runtime role for profile and interest endpoints.

`db:reset` destroys **only this local project's synthetic data**, resets the local
Supabase infrastructure, applies Drizzle migrations, provisions the local runtime
login, seeds, and verifies permissions. It requires `NODE_ENV=development` or
`test`, an exact loopback migration target on port 55432/database `postgres`, and
accepts no extra arguments. Production/hosted targets and connection URL options
are refused. No hosted reset/migrate command is provided at this stage.

```sh
pnpm db:migrate  # apply pending Drizzle migrations; safe to repeat
pnpm db:seed     # repeatable no-op; the interest catalogue is in the migration
pnpm db:verify   # replay migration runner and check real database privileges
pnpm db:stop     # stop this project's containers, preserving local data
```

Drizzle SQL and metadata in `packages/database/migrations` are the **only
application schema history**. Supabase migrations/seeds are disabled. Do not use
schema push, Supabase migrations, or dashboard schema edits. To add schema later:

```sh
pnpm --filter @swapcircle/database generate
pnpm --filter @swapcircle/database generate --custom --name=descriptive_name
```

Review generated SQL before applying it. Every exposed application table must
include RLS, explicit grants, and appropriate policies in the same change. The
initial migration removes implicit browser table/sequence/function grants;
functions also lose PostgreSQL's global PUBLIC EXECUTE default. Migration objects
must be created by `postgres` for those defaults to apply. The runtime role has no
DDL, inheritance, or RLS bypass privileges. Profile, interest and private account
restriction tables have explicit runtime grants and RLS policies; browser roles
have no application table access. There are no seeded accounts. Permission probes
are synthetic and rolled back.

The server-only `createDatabase` factory uses at most five connections and provides
`close()` for shutdown. Remote runtime connections require certificate-verified
TLS; URL query overrides are rejected. Migration connections use one connection.
Database credentials and CLI output are never printed by the wrapper commands.
CI runs a fresh isolated local rebuild and privilege checks without hosted secrets.

## Authentication

The browser uses Supabase Google OAuth with PKCE and email/password sign-in for
provisioned, confirmed accounts. `/sign-in` calls the Supabase SDK,
`/auth/callback` exchanges the one-use code, and `/account` checks the protected
Express `/api/v1/identity` endpoint. The callback accepts only implemented local
destinations. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in
`apps/web/.env`; configure `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in
`apps/api/.env`. Use the same local project for both. These keys are public;
never substitute a service-role key. The API fails startup if auth configuration
is missing. Keep its `CORS_ORIGINS` aligned with the frontend origin.

For local Google OAuth, configure a development Google client with JavaScript
origin `http://127.0.0.1:5173` and Google callback
`http://127.0.0.1:55431/auth/v1/callback`. Store
`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and
`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET` in the ignored root `.env`.
`pnpm db:start` enables Google for startup only when both credentials exist in
the root `.env` or process environment, then restores the checked-in disabled
configuration even if startup fails. Partial credentials fail with a safe error.
Use `pnpm db:stop` followed by `pnpm db:start` to apply changed credentials
(preserve data; do not reset it). Avoid concurrent local start commands. The app redirect allowlist
is restricted to the local `/auth/callback` path, including its `next` query.
Google remains disabled by default so CI and credential-free local development
can run without pretending OAuth is configured. Hosted setup belongs to the
later deployment work.

The API verifies tokens using the Supabase SDK, then checks issuer, authenticated
audience/role, expiry and a UUID subject. The identity endpoint returns only the
verified user ID with `Cache-Control: no-store`. It grants no resource permissions.
Account changes abort protected requests, cancel/clear Query state, remove
Supabase channels and remount local drafts/drawers. Same-user token refreshes keep
local UI state. Sign-out affects this browser session; an already issued access
token remains valid until expiry, as with Supabase's standard JWT lifecycle.

`pnpm --filter @swapcircle/api test:auth-local` verifies real SDK sessions for two
temporary synthetic users against **only** the loopback stack on port 55431,
checks valid/tampered/missing tokens, signs out and deletes those users. It uses
temporary random passwords to verify successful and rejected password sign-in. This check is included in the isolated database CI
job. Browser tests mock OAuth transport while exercising the real browser SDK;
those tests do not replace the manual Google OAuth integration checkpoint.

Password login does not send email or create accounts. Local `[auth.email].enable_signup = true` enables the email provider;
`[auth].enable_signup = false` prevents new accounts for all providers, including
Google. Existing provisioned Google accounts can still sign in locally. Provision confirmed synthetic
accounts with passwords through trusted local tooling; no demo seed or hosted
account changes are part of this feature. Passwords are passed directly to
Supabase, never trimmed, logged, or stored by application code. AuthProvider owns
SDK sessions and the same cache/draft cleanup for both login methods. The form
uses shared Zod validation, generic failures, and disables both methods while a
request is pending. Supabase Auth enforces IP-based `/token` rate limits (including
password login); frontend disabling is only duplicate-request protection.

Hosted prerequisites: email provider enabled, confirmed provisioned accounts with
passwords, HTTPS, and reviewed Supabase Auth rate limits. If CAPTCHA is enabled,
this form needs a CAPTCHA token integration before hosted password login can
succeed. Public registration, reset, and email delivery remain out of scope and
require custom SMTP before adding those workflows. No hosted settings were changed.
`pnpm --filter @swapcircle/web test:password-local` runs the production browser
form against loopback Supabase and Express, checks failures and two accounts,
reload/logout and safe redirects, then deletes its temporary Auth accounts.
It rebuilds the web bundle for local configuration; run `pnpm build` afterward
before other preview suites.

See the official [password login SDK reference](https://supabase.com/docs/reference/javascript/auth-signinwithpassword),
[password auth guide](https://supabase.com/docs/guides/auth/passwords), and
[Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).

## Profiles and interests

`GET /api/v1/profiles/me` provisions the signed-in user's profile once and returns
their current public fields and timestamps. `PUT /api/v1/profiles/me` updates the
verified owner's display name, biography, approximate location and selected
interest IDs. `GET /api/v1/interests` lists selectable interests, while
`GET /api/v1/members/:id` returns only public profile fields. Duplicate or unknown
interest IDs fail without changing the profile. Private restriction records never
appear in public responses.

`pnpm --filter @swapcircle/api test:profiles-local` checks these endpoints with
temporary synthetic users, direct Data API denial, and cleanup against the
isolated local stack. It runs in the database CI job.

### Listing records

`POST /api/v1/listings` creates an available listing owned by the verified user.
Supply `title` (1–120 characters), `description` (1–5000), and `condition`
(`like_new`, `good`, `fair`, or `poor`). Ownership, availability and timestamps
are server-managed; unknown request fields are rejected.

`GET /api/v1/listings?limit=20&cursor=…` returns `{ items, nextCursor }`, newest
first with UUID as the tie-breaker. Limits are 1–50; pass the returned opaque
cursor unchanged. `GET /api/v1/listings/:id` returns the public listing projection.
Withdrawn items are excluded from both reads and return 404 on detail reads;
a later detail UI can use this safe not-found response as its unavailable state.
Other availability states remain visible with their explicit status.

`PUT /api/v1/listings/:id` replaces editable fields and requires the current
`revision`. `POST /api/v1/listings/:id/withdraw` accepts only `{ revision }`.
Both require the owner, reject restricted accounts, lock the listing row and
increment its revision. Stale revisions and non-available states return 409;
non-owner writes return 404. No endpoint can restore a withdrawn listing or set
trade-controlled availability. Future trade operations must lock these same rows
and update availability atomically with their reservations/events.

`pnpm --filter @swapcircle/api test:listings-local` checks real local authentication,
ownership, validation rollback, revision races, availability guards, withdrawal
visibility, pagination ties at microsecond precision, and direct Data API denial.
It uses isolated synthetic accounts and removes its fixtures afterward.
