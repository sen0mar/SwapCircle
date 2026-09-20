# SwapCircle Agent Guidelines

## Scope and references

- Keep changes small, typed, and within the requested scope. Do not invent workflows or add deferred features or dependencies without an explicit need.
- For domain rules, data access, security, or deployment work, read the relevant section of [`context/ARCHITECTURE.md`](context/ARCHITECTURE.md).
- For frontend styling, layout, interactions, or accessibility, read the relevant section of [`context/ui-context(7).md`](context/ui-context(7).md) and use the supplied reference images when applicable.

## Code standards

- Use strict TypeScript and the existing pnpm workspace scripts. Keep browser and server dependencies separated.
- Preserve repository boundaries: web UI in `apps/web`, Express features in `apps/api`, shared Zod/API contracts in `packages/contracts`, and schema/migrations in `packages/database`.
- In the API, keep routes thin and place business rules in services and persistence in repositories. Validate untrusted input at the server boundary with shared Zod schemas.
- Express owns all application writes. Supabase client access is limited to authentication and explicitly authorized reads/realtime behavior defined by the architecture.
- TanStack Query owns server state, React owns local UI state, and URL parameters own shareable filters. Do not duplicate these sources of truth.
- Use semantic UI tokens and existing shadcn primitives; do not hardcode colors or weaken keyboard/focus behavior. Render user content as plain text.
- Add focused tests with behavior changes, especially for authorization, transactions, retries, concurrency, and failure states. Run the relevant lint, typecheck, test, and build commands before marking work complete.

## Commit messages

- Every commit, including merge commits, must have a short title followed by a blank line and a brief description of what changed and why.
- Describe the actual change; do not mention "step" or implementation-plan step numbers in commit titles or descriptions.

## Safety and dangerous operations

- **Drizzle migrations are the only schema history. Never use schema push commands** (for example `drizzle-kit push` or `db push`) or make undocumented Supabase dashboard schema changes.
- Never run destructive database resets, seeds, migrations, or tests against production. Seeds and fixtures must be synthetic and isolated.
- Keep destructive migrations separate and explicit. Preserve data and rollback compatibility; do not silently drop or rewrite persisted data.
- Never bypass authorization or RLS for convenience. Derive identity from the verified token, never from client-supplied ownership fields, and enforce permissions on every protected operation.
- Never expose service-role keys, database credentials, tokens, private messages, email addresses, or precise meeting details. Treat every `VITE_*` value as public.
- Do not perform direct browser storage writes, hold database transactions while awaiting user action, or split an atomic domain change from its events/notifications.
- Do not use destructive Git commands, overwrite unrelated work, edit production data, deploy, or enable paid services unless the user explicitly requests it.
- Do not claim a check, migration, backup, deployment, or integration succeeded unless it was actually run and verified.
