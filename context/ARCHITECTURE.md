# SwapCircle Architecture

**Status:** Initial implementation blueprint · **Updated:** 2026-09-19

## 1. Product rules

SwapCircle is a community for exchanging belongings and optionally meeting socially.

- **Trades involve two or more people**, with one or more items per person. Do not require three participants, automatic cycle matching, equal valuations, predefined wishlists, or membership in a closed community. Store participants and transfers as rows, not fixed user slots.
- Profiles contain a biography, approximate location, and selectable interests. Listings contain photos, condition, description, and ownership. Messaging and negotiation may precede proposals.
- **Meet to swap** is always available. **Swap + coffee** appears only when the inviter and invitee share at least **two distinct interest IDs**, verified by the backend. “Coffee’s on me” is an optional invitation flag; payment happens in person.
- For group trades, evaluate coffee eligibility per inviter/invitee pair. Eligible participants may meet socially without requiring everyone to share interests. Check eligibility when sending and accepting; later profile changes do not invalidate accepted plans.
- Coffee requires separate consent. Declining or cancelling coffee never cancels the trade or penalizes the member.
- Direct messages exist independently of trades. Trades with three or more participants receive a separate group conversation. Conversation membership is not trade acceptance. Never expose private messages to a group.

## 2. System and tool choices

One TypeScript monorepo, one modular Express service, one PostgreSQL database.

| Area | Choice |
|---|---|
| Frontend | React, TypeScript, Vite, React Router; Cloudflare Pages |
| Client data and UI | TanStack Query; React state; React Hook Form + Zod; Tailwind CSS + shadcn/ui |
| API | Node.js + Express + TypeScript; Render Free; native `fetch` client wrapper |
| Identity | Supabase Auth + `@supabase/supabase-js`; Google OAuth initially |
| Persistence | Supabase PostgreSQL; Drizzle ORM + `pg`; Drizzle Kit migrations |
| Files and live updates | Supabase Storage + Sharp; Supabase Realtime |
| Security | Helmet, `cors`, `express-rate-limit`; database-backed action quotas |
| Quality and delivery | pnpm workspaces, strict TypeScript, ESLint, Prettier, GitHub Actions, Dependabot |
| Tests | Vitest, React Testing Library, Supertest, Playwright; MSW and axe-core |
| Observability | Pino + `pino-http`; Sentry errors with private source-map uploads |

```text
Browser ── HTTPS /api/v1 ──> Express ── Drizzle/pg ──> PostgreSQL
   ├── sign-in / sessions ─────────────────────────> Supabase Auth
   ├── permitted chat/notification reads + events ──> Supabase Data API / Realtime
   └── published image reads ──────────────────────> Supabase Storage
Express ── validate/process uploads ───────────────> Supabase Storage
```

**Express owns all application writes**, including messages, membership, notifications, uploads, and trade transitions. Auth exchanges go directly to Supabase. All remaining application reads use Express. Realtime supplements persisted data; it is not the source of truth.[^realtime]

## 3. Repository and application boundaries

```text
apps/web/                 React routes, components, feature hooks
apps/api/                 Feature modules: routes → services → repositories
packages/contracts/       Shared Zod request/response schemas and API types
packages/database/        Drizzle schema, SQL migrations, synthetic seeds
supabase/                 Local Supabase configuration, not a second migration history
tests/e2e/               Cross-user browser scenarios
.github/workflows/        Checks and controlled releases
```

TanStack Query owns server data; React state owns local UI; URL parameters own shareable filters. Add Zustand only for cross-page local state, not server caches. Supabase owns auth sessions; clear user-specific caches/subscriptions on logout or account change.

Validate requests in Express with shared Zod schemas. Keep business rules in services and database code server-only. Use versioned REST, bounded pagination, and safe errors: `{ error: { code, message, requestId } }`. Use UTC ISO timestamps in API responses and explicit conflict responses for stale proposals.

## 4. Core data model

Use UUIDs, foreign keys, unique constraints, and `timestamptz`. Index ownership, membership, foreign keys, and pagination paths. Search listings with PostgreSQL full-text search.

| Tables | Responsibility |
|---|---|
| `profiles`, `interests`, `profile_interests` | Profile ID references `auth.users.id`; interests unique per profile; private account/moderation fields separated from public output |
| `listings`, `listing_photos` | Owner, condition, availability, processed storage keys; retain item snapshots referenced by proposals |
| `trades`, `trade_versions`, `trade_participants`, `trade_items` | Versioned terms, invitations, version-specific acceptances; each item records owner and recipient |
| `item_reservations`, `trade_events` | At most one active reservation per listing; append-only transition history |
| `meetups`, `meetup_responses`, `coffee_invitations` | Private place/time, confirmations, pairwise coffee invitations and payer offer |
| `conversations`, `conversation_members`, `messages` | Direct/group identity, accepted membership, durable messages and deduplication IDs |
| `notifications`, `blocks`, `reports`, `action_quotas` | Recipient-only notifications, abuse controls, moderation, persistent usage limits |

Keep precise meeting details out of public profiles and listings. Store meeting instants plus an IANA time-zone name. Changing the meeting location/time requires renewed meeting confirmations, not automatic acceptance.

## 5. Trade lifecycle and consistency

```text
proposed → confirmed → completed
proposed → declined | expired | cancelled
confirmed → cancelled (before any handover) | disputed
```

Proposals include participants, transfers, a version, and an expiry. Each owner must accept the exact version containing their items. Membership, items, or material condition changes create a new version and invalidate all earlier acceptances. Freeze confirmed terms; renegotiation requires explicit cancellation and a new proposal.

On final acceptance, use one short transaction: lock the trade and listings in deterministic order, recheck version, expiry, ownership, membership, blocks, and availability; record acceptance; reserve every item; confirm the trade; persist events and notifications. Commit everything or nothing. Enforce one active reservation per listing with a unique partial index. Never hold locks while awaiting a person’s response.

Make acceptance, confirmation, and message submission retry-safe using unique operation keys. Competing proposals cannot confirm reserved items and must show their unavailability. Check expiration on reads/writes, not only through scheduled cleanup.

Completion requires every participant to acknowledge receipt; mark listings exchanged, not available again. Cancellation before any reported handover releases reservations atomically; reported partial handovers/problems enter `disputed` and require explicit resolution before releasing items. Persist cancellation and dispute history.

## 6. Authentication, authorization, and secrets

Supabase manages credentials and session refresh. **Do not add a password column or application-side hashing**; Supabase handles password hashing when password login is enabled.[^passwords] Launch with Google OAuth; enable public email/password flows only after configuring custom SMTP.[^smtp]

Express verifies bearer tokens with `getClaims(token)` and validates the expected issuer, audience, and expiry; derive identity from verified `sub`, never client-supplied ownership fields.[^claims] Check current account restrictions and resource permissions on every protected operation; token validity does not grant resource access.

Enable RLS on every exposed table and explicitly restrict grants. Allow authenticated clients only authorized chat/membership reads and their own notification reads. Deny direct application writes, including alternative RPC paths. Membership is server-managed. Backend database roles do not automatically impersonate the user; enforce API authorization even where a privileged connection bypasses RLS.[^rls]

Use least-privilege runtime credentials and separate migration credentials. Only the Supabase URL/publishable key and API URL belong in public frontend configuration. `VITE_*` values are public; secret/service-role keys, database passwords, and deployment tokens stay server-side or in CI.[^vite]

Allowlist CORS origins and OAuth redirects. Set API headers with Helmet and frontend CSP/security headers through Cloudflare Pages. Render user text as plain text. Apply upload/body limits, burst throttling, and persistent action quotas; CORS is not authorization. Support blocking/reporting from launch. Blocks in either direction prevent DMs and new joint trade/coffee invitations. Existing groups remain member-visible; leaving revokes further access.

## 7. Messaging and media

Send messages through Express; read authorized history and receive events through Supabase. Enforce unique `(sender_id, client_message_id)` keys; use stable cursors, pending/failed states, and reconnect backfills. Recheck membership on all sends and blocks on direct sends. Group invitations require acceptance before access; never convert a direct conversation into a group. Do not describe messages as end-to-end encrypted.

Create notifications transactionally with important domain changes. Update TanStack Query after events; never optimistically declare a trade confirmed.

Allow up to three listing photos. Enforce byte, pixel, and processing-concurrency limits; decode and re-encode with Sharp, strip metadata, and store processed files only. Published listing photos/avatars are intentionally public; private content must never use a public bucket. Deny browser storage writes. Keep uploads off Render’s persistent filesystem assumptions; clean orphaned objects after failed operations.

## 8. Development, deployment, and operations

Run Supabase locally using its CLI and Docker-compatible runtime. Pin supported Node/pnpm versions and commit the lockfile. Document environment variables without secrets. Use synthetic seeds and isolated development/test/preview data, never production accounts or conversations.

**Drizzle migrations are the only schema history**, including custom SQL for RLS, grants, triggers, and constraints.[^migrations] No undocumented dashboard edits or production schema-push commands. Use a small `pg` pool with verified TLS; use Supabase’s session pooler when IPv4 connectivity requires it.[^connections]

GitHub Actions: lint/typecheck → unit/component tests → local database + migrations → API/RLS tests → builds → critical Playwright tests. Protect `main`; restrict secrets, pin third-party actions, and review Dependabot updates.

Serialize releases: backward-compatible migrations → Render deploy and readiness check → Cloudflare Pages upload through Wrangler → smoke tests.[^deploy] Verify the intended API revision is healthy; a deploy-hook response is insufficient. Separate destructive migrations; retain rollback-compatible application builds. Previews must not receive production credentials.

Log request IDs and safe metadata with Pino. Use Sentry errors without session replay; redact tokens, message bodies, email addresses, and meeting details. Alert on errors and inspect storage, bandwidth, and realtime usage. Provide liveness/readiness endpoints and honest API-wakeup states.

Target **$0 within free allowances**, not unlimited availability. Render Free sleeps and has ephemeral storage; Supabase Free may pause and lacks included automatic backups.[^free] No keepalive workarounds or automatic paid add-ons. Export encrypted database backups and storage objects separately; test restoration.[^backups] Use Supabase Cron for cleanup when needed, never in-process timers as the authority for expiry.

## 9. Required acceptance tests and deferred scope

Before release, verify unauthorized reads/writes through both Express and direct Supabase access; forged identity fields; exactly-one versus two shared interests; independent coffee consent; private-to-group isolation; blocked contact; stale acceptances; concurrent reservations; duplicate retries; partial-handover disputes; reconnect recovery; and logout cache clearing. Cover direct and multi-person trades, migration replay, upload rejection, keyboard navigation, and automated accessibility checks.

Deferred: payments, shipping, automatic cycle discovery, AI matching, video/chat attachments, Socket.IO, Redis/queues, presence indicators, and external venue/search services. Zustand, Turnstile, analytics, and email delivery are optional additions with an explicit need and cost review.

## References

Provider documentation checked on 2026-09-19; recheck plan terms before deployment.

[^realtime]: Supabase Postgres Changes: `https://supabase.com/docs/guides/realtime/postgres-changes`
[^passwords]: Supabase password security: `https://supabase.com/docs/guides/auth/password-security`
[^smtp]: Supabase email configuration: `https://supabase.com/docs/guides/auth/auth-smtp`
[^claims]: Supabase token verification: `https://supabase.com/docs/reference/javascript/auth-getclaims`
[^rls]: Supabase RLS and grants: `https://supabase.com/docs/guides/database/postgres/row-level-security`
[^vite]: Vite public environment variables: `https://vite.dev/guide/env-and-mode`
[^migrations]: Drizzle custom migrations: `https://orm.drizzle.team/docs/kit-custom-migrations`
[^connections]: Supabase database connections: `https://supabase.com/docs/guides/database/connecting-to-postgres`
[^deploy]: Cloudflare CI deployment: `https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/`
[^free]: Free-tier constraints: `https://render.com/docs/free` and `https://supabase.com/pricing`
[^backups]: Supabase backup limitations: `https://supabase.com/docs/guides/platform/backups`
