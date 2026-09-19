# SwapCircle

A pnpm workspace with a small React app and reserved API, contracts, and database packages.

Use Node **24.13.0** (also pinned in `.node-version`) and pnpm **11.5.3**.

```sh
pnpm install --frozen-lockfile
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

The focused route tests use Node's test runner and Vite's TypeScript transform. Browser navigation should also be checked against the running development server.

- `apps/web`: browser UI; only browser-safe dependencies belong here.
- `apps/api`: reserved for Express; no server is started yet.
- `packages/contracts`: reserved for shared API contracts.
- `packages/database`: reserved for database code; no database is configured yet.

Dependencies must be declared in their consuming package. Server packages expose only a Node export condition, and lint rejects server-package imports from web code. There are no workspace-wide source aliases. TypeScript uses Bundler resolution for Vite and NodeNext for Node packages.

No environment variables are required for this foundation. Keep credentials out of browser code and out of Git. The architecture and UI references remain in `context/`.
