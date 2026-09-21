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
The API does not connect to persistence until a later feature needs it.

`db:reset` destroys **only this local project's synthetic data**, resets the local
Supabase infrastructure, applies Drizzle migrations, provisions the local runtime
login, seeds, and verifies permissions. It requires `NODE_ENV=development` or
`test`, an exact loopback migration target on port 55432/database `postgres`, and
accepts no extra arguments. Production/hosted targets and connection URL options
are refused. No hosted reset/migrate command is provided at this stage.

```sh
pnpm db:migrate  # apply pending Drizzle migrations; safe to repeat
pnpm db:seed     # repeatable no-op until domain fixtures are introduced
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
DDL, inheritance, or RLS bypass privileges; later features must explicitly grant
only their required operations and policies. There are no domain tables or seed
accounts yet. Permission probes are synthetic and rolled back.

The server-only `createDatabase` factory uses at most five connections and provides
`close()` for shutdown. Remote runtime connections require certificate-verified
TLS; URL query overrides are rejected. Migration connections use one connection.
Database credentials and CLI output are never printed by the wrapper commands.
CI runs a fresh isolated local rebuild and privilege checks without hosted secrets.
