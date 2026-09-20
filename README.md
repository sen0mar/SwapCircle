# SwapCircle

A pnpm workspace with React, Express, shared API contracts, and a reserved database package.

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

Vitest runs typed Supertest API tests and React Testing Library component tests with MSW network handlers. Existing Node regression tests remain alongside them. MSW runs only in tests; its optional worker installation script is disabled. Playwright covers the Home/theme/navigation/drawer smoke, accessibility, production exclusions, and real Express stop/restart recovery. Tests use synthetic data and local services; no database or credentials are required. GitHub Actions runs on pushes and pull requests with read-only repository permission and no deployments.

- `apps/web`: browser UI; only browser-safe dependencies belong here.
- `apps/api`: Express app factory and separate listening process.
- `packages/contracts`: browser-safe Zod API contracts.
- `packages/database`: reserved for database code; no database is configured yet.

Dependencies must be declared in their consuming package. Server packages expose only a Node export condition, and lint rejects server-package imports from web code. There are no workspace-wide source aliases. TypeScript uses Bundler resolution for Vite and NodeNext for Node packages.

For the development API status view at `/dev/api-status`, run in a second terminal:

```sh
cp apps/api/.env.example apps/api/.env
pnpm --filter @swapcircle/api dev
```

The default web origin is `http://127.0.0.1:5173`. `CORS_ORIGINS` is required: a comma-separated list of exact HTTP(S) origins without paths or trailing slashes. `PORT` defaults to 3001. Invalid settings fail startup without printing their values. The API dev command compiles before starting; rerun it after TypeScript changes. For compiled operation use `pnpm --filter @swapcircle/api start`.

`VITE_API_URL` is the public API origin (default `http://127.0.0.1:3001`); use `apps/web/.env.example` when overriding it. `/api/v1/live` reports process liveness only. No database, authentication, or readiness check exists yet. JSON bodies are limited to 16 KiB. CORS is browser access control, not authorization.

The development status page uses TanStack Query and native fetch, supports cancellation and a 15-second timeout, and retries only on request. It is omitted from production builds. `pnpm --filter @swapcircle/web test:browser` verifies browser behavior including stopping/restarting an isolated API on port 4311; ports 4173/4174 must also be available. No credentials are needed. Keep credentials out of browser code and out of Git. The architecture and UI references remain in `context/`.
