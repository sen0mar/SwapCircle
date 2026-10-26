# SwapCircle Architecture

**Status:** Implementation blueprint · **Updated:** 2026-10-22

## 1. Product rules

SwapCircle is a community for exchanging belongings and optionally meeting socially.

- **Trades involve exactly two distinct people**, with one or more items per person. The pair is fixed at creation; changing either person requires a new proposal. Every transfer goes to the other person. Do not require equal valuations, predefined wishlists, or membership in a closed community. Retain participant rows for individual version-specific acceptances.
- Profiles contain a biography, approximate location, and selectable interests. Listings contain photos, condition, description, and ownership. Messaging and negotiation may precede proposals. The listing “Propose a trade” entry point creates versioned two-person trade terms after both sides’ items are selected and reviewed, then opens the swap details. Each person must separately accept the exact version before confirmation and item reservation. Previously saved Inbox proposals remain accessible as message history and do not count as acceptance of trade terms.
- **Meet to swap** is always available. **Swap + coffee** appears only when the inviter and invitee share at least **two distinct interest IDs**, verified by the backend. “Coffee’s on me” is an optional invitation flag; payment happens in person.
- Check coffee eligibility when sending and accepting; later profile changes do not invalidate accepted plans.
- Coffee requires separate consent. Declining or cancelling coffee never cancels the trade or penalizes the member.
- Direct messages exist independently of trades. The same two people coordinate through their direct conversation. Messaging is not acceptance of formal trade terms.

## 2. System and tool choices

One TypeScript monorepo, one modular Express service, one PostgreSQL database.

| Area | Choice |
|---|---|
| Frontend | React, TypeScript, Vite, React Router; Cloudflare Pages |
| Client data and UI | TanStack Query; React state; React Hook Form + Zod; Tailwind CSS + shadcn/ui |
| API | Node.js + Express + TypeScript; Render Free; native `fetch` client wrapper |
| Identity | Supabase Auth + `@supabase/supabase-js`; Google OAuth + provisioned-account password sign-in |
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
apps/web/                 React routes → pages/components → feature hooks → API functions
apps/api/                 Feature modules: routes → controllers → services → repositories
packages/contracts/       Shared Zod request/response schemas and API types
packages/database/        Drizzle schema, SQL migrations, synthetic seeds
supabase/                 Local Supabase configuration, not a second migration history
tests/e2e/               Cross-user browser scenarios
.github/workflows/        Checks and controlled releases
```

TanStack Query owns server data; React state owns local UI; URL parameters own shareable filters. Add Zustand only for cross-page local state, not server caches. Supabase owns auth sessions; clear user-specific caches/subscriptions on logout or account change.

Validate requests in Express with shared Zod schemas. Keep business rules in services and database code server-only. Use versioned REST, bounded pagination, and safe errors: `{ error: { code, message, requestId } }`. Use UTC ISO timestamps in API responses and explicit conflict responses for stale proposals.

### React feature structure

Organize the frontend by feature, separating route registration, rendering, lifecycle/data hooks, and transport:

```text
apps/web/src/
  main.tsx                         Browser bootstrap and provider composition
  App.tsx                          Shared page shell and accessibility landmarks
  routes.tsx                       URLs, page registration, and route guards
  pages/NotFoundPage.tsx            App-wide fallback page
  components/ui/                   Shared accessible UI primitives
  components/layout/               Header and shared layout controls
  lib/api-client.ts                Fetch transport, cancellation, safe errors
  features/
    auth/
      client.ts                    Supabase SDK configuration
      AuthProvider.tsx             Session lifecycle and account cleanup
      RequireAuth.tsx              Loading and signed-out route behavior
      SignInPage.tsx
      AuthCallbackPage.tsx
      useGoogleSignIn.ts
      useAuthCallback.ts
      safe-destination.ts          Pure redirect validation
    account/
      AccountPage.tsx
      AccountControl.tsx
      AccountDrawer.tsx
      useIdentity.ts               User-scoped Query state
      account-api.ts               Typed identity request
    development/                   Lazy, development-only page, hook, API function
    home/                          Homepage composition and presentation
    browse/                        Browse page
```

- **Routes** select pages, attach session guards, and define loading boundaries. Keep page markup and network operations in their feature files. `App.tsx` composes the shared shell; `main.tsx` wires the router and providers.
- **Pages and components** render state and connect user actions to feature hooks. Keep reusable UI in `components/` and feature-specific UI beside its page. Simple visual state, such as an open drawer or inline recovery feedback, can remain in the component.
- **Feature hooks** coordinate lifecycle, async actions, and TanStack Query queries/mutations. They own query keys, retries, invalidation, and request cancellation. Include the user ID in private query keys and pass Query's abort signal through to transport. Keep shareable filters in the URL rather than copying them into React state.
- **API functions** such as `account-api.ts` define endpoint paths and shared response schemas, using the common fetch wrapper or the authenticated request function supplied by `AuthProvider`. They do not render UI, navigate, or maintain a second cache. The auth feature may call Supabase Auth directly through its SDK; future approved realtime reads/subscriptions follow the existing access rules.

Keep `AuthProvider` as the single session lifecycle owner, including token attachment and cancellation/cache/draft/subscription cleanup on identity transitions. Route guards provide loading and sign-in navigation; Express remains responsible for authorization. Pure helpers such as redirect validation belong in separate modules without client initialization side effects.

Use these layers only where a feature needs them: static pages need no hook or API file, and frontend code needs no database repository layer. Keep development fixtures and routes behind development-only lazy imports. Verify refactors through existing route, component, and browser tests, preserving URLs, query/hash destinations, loading/error/retry behavior, drawer focus, and account isolation.

### Express feature structure

Organize API code by feature, keeping each layer in its own file:

```text
apps/api/src/
  server.ts                        Environment, dependency construction, listener
  app.ts                           App factory and global middleware order
  routes.ts                        Feature-router registration under /api/v1
  auth/verify.ts                    Supabase token verification adapter
  middleware/
    authenticate.ts                Bearer-token gate and verified identity
    request-id.ts                  Server-generated request IDs
    not-found.ts                    Safe response for unmatched routes
    error-handler.ts               Centralized HTTP error handling
  http/error-response.ts            Shared safe error-envelope helper
  features/
    health/
      health.routes.ts
      health.controller.ts
    identity/
      identity.routes.ts
      identity.controller.ts
```

- **Routes** declare methods and paths, attach authentication and shared-schema validation where needed, and select controllers. They contain no business rules or database queries.
- **Controllers** translate validated HTTP inputs and the verified identity into service calls, then send typed responses with the appropriate status and headers. They do not verify tokens or access the database directly.
- **Services** enforce resource permissions and business rules, coordinate repositories, and own transaction boundaries. Keep them independent of Express request/response objects; pass the verified actor explicitly.
- **Repositories** perform persistence operations through Drizzle/`pg`, accepting the service's transaction when operations must be atomic. They do not handle HTTP or create separate commits inside a service-owned transaction.

Add `<feature>.service.ts` and `<feature>.repository.ts` in the same feature folder when required. Liveness and identity currently need only routes and controllers; do not create empty layers. Authentication attaches a typed `identity` to request-scoped `response.locals`; controllers pass that identity onward instead of trusting client-supplied ownership fields. Authentication alone does not authorize access to a resource.

Keep `createApp` testable without opening a listener. Inject external dependencies through app/router factories; construct production adapters in `server.ts`. Register request IDs before middleware that may fail, mount feature routers after security/body middleware, then register the not-found and final error handlers. Preserve public URLs and response contracts when reorganizing these layers. Test the assembled HTTP boundary for authentication, status codes, headers, and safe errors; add service/repository tests as business logic and persistence arrive.

## 4. Core data model

Use UUIDs, foreign keys, unique constraints, and `timestamptz`. Index ownership, membership, foreign keys, and pagination paths. Search listings with PostgreSQL full-text search.

| Tables | Responsibility |
|---|---|
| `profiles`, `interests`, `profile_interests` | Profile ID references `auth.users.id`; interests unique per profile; private account/moderation fields separated from public output |
| `listings`, `listing_photos` | Owner, condition, availability, processed storage keys; retain item snapshots referenced by proposals |
| `trades`, `trade_versions`, `trade_participants`, `trade_items` | Versioned terms, invitations, version-specific acceptances; each item records owner and recipient |
| `item_reservations`, `trade_events` | At most one active reservation per listing; append-only transition history |
| `meetups`, `meetup_responses`, `coffee_invitations` | Private place/time, confirmations, pairwise coffee invitations and payer offer |
| `conversations`, `conversation_members`, `messages` | Fixed direct-message pair, access membership, durable messages and deduplication IDs |
| `notifications`, `blocks`, `reports`, `action_quotas` | Recipient-only notifications, abuse controls, moderation, persistent usage limits |

Keep precise meeting details out of public profiles and listings. Store meeting instants plus an IANA time-zone name. Changing the meeting location/time requires renewed meeting confirmations, not automatic acceptance.

## 5. Trade lifecycle and consistency

```text
proposed → confirmed → completed
proposed → declined | expired | cancelled
confirmed → cancelled (before any handover) | disputed
```

Proposals include participants, transfers, a version, and an expiry. Each owner must accept the exact version containing their items. Item or material condition changes create a new version and invalidate all earlier acceptances. Participants cannot be added, removed, or replaced. Freeze confirmed terms; renegotiation requires explicit cancellation and a new proposal.

On final acceptance, use one short transaction: lock the trade and listings in deterministic order, recheck version, expiry, ownership, membership, blocks, and availability; record acceptance; reserve every item; confirm the trade; persist events and notifications. Commit everything or nothing. Enforce one active reservation per listing with a unique partial index. Never hold locks while awaiting a person’s response.

Make acceptance, confirmation, and message submission retry-safe using unique operation keys. Competing proposals cannot confirm reserved items and must show their unavailability. Check expiration on reads/writes, not only through scheduled cleanup.

Completion requires every participant to acknowledge receipt; mark listings exchanged, not available again. Cancellation before any reported handover releases reservations atomically; reported partial handovers/problems enter `disputed` and require explicit resolution before releasing items. Persist cancellation and dispute history.

My Swaps is a reminder list for confirmed trades and a history of completed trades. Confirmed trades remain in the reminder list after their meeting date. Once that date passes, a participant can explicitly acknowledge receipt from the card; each person’s acknowledgement immediately moves the swap into their own history independently of the other person. Personal history includes globally completed trades and confirmed trades with that viewer’s saved receipt. Shared trade completion and inventory exchange still require both receipts; a personal history entry does not change the other person’s reminder. Swap details opened from reminders and history are read-only: show items, saved meetup date/time/location and chat access, without meetup editing, acceptance/decline, coffee, cancellation or problem-report forms. Pending proposals retain their existing review flow. Keep the server problem-reporting lifecycle, saved term versions, meeting responses, and append-only events for handover/cancellation safeguards. Accepted message offers open their private swap detail page, with a link back to the conversation; recipient-suggested meetup details are stored with acceptance when supplied and either participant can revise the arrangement there. Earlier acceptances without a meetup remain unscheduled. These offers have no structured trade reservation or receipt lifecycle.

## 6. Authentication, authorization, and secrets

Supabase manages credentials and session refresh. **Do not add a password column or application-side hashing**; Supabase handles password hashing when password login is enabled.[^passwords] Support Google OAuth (PKCE) and email/password sign-in for provisioned, confirmed accounts through `signInWithPassword`. Supabase owns credentials, refresh, and IP-based auth endpoint rate limits; the UI disables duplicate submissions and displays generic credential failures. No public signup or password-reset flow is exposed. Enable email-delivery workflows only after configuring custom SMTP.[^smtp] Hosted password login requires the email provider enabled, confirmed accounts with passwords, and appropriate Supabase Auth rate limits. The shared demo guest uses a server-only password secret and a normal Supabase session, with explicit origin/rate checks and server-owned seed readiness metadata; it grants no authorization bypass. If hosted CAPTCHA is enabled, integrate its token into the form before using password login; the current form does not supply CAPTCHA tokens.

Express verifies bearer tokens with `getClaims(token)` and validates the expected issuer, audience, and expiry; derive identity from verified `sub`, never client-supplied ownership fields.[^claims] Check current account restrictions and resource permissions on every protected operation; token validity does not grant resource access.

Enable RLS on every exposed table and explicitly restrict grants. Allow authenticated clients only authorized chat/membership reads and their own notification reads. Deny direct application writes, including alternative RPC paths. Membership is server-managed. Backend database roles do not automatically impersonate the user; enforce API authorization even where a privileged connection bypasses RLS.[^rls]

Use least-privilege runtime credentials and separate migration credentials. Only the Supabase URL/publishable key and API URL belong in public frontend configuration. `VITE_*` values are public; secret/service-role keys, database passwords, and deployment tokens stay server-side or in CI.[^vite]

Allowlist CORS origins and OAuth redirects. Set API headers with Helmet and frontend CSP/security headers through Cloudflare Pages. Render user text as plain text. Apply upload/body limits, burst throttling, and persistent action quotas; CORS is not authorization. Support blocking/reporting from launch. Blocks in either direction prevent DMs and new joint trade/coffee invitations. Existing direct-message history remains subject to membership and account restrictions.

## 7. Messaging and media

Send messages through Express; read authorized history and receive events through Supabase. Enforce unique `(sender_id, client_message_id)` keys; use stable cursors, pending/failed states, and reconnect backfills. Recheck membership on all sends and blocks on direct sends. Conversations have exactly two fixed identities; membership checks cannot admit a third person. Do not describe messages as end-to-end encrypted.

Create notifications transactionally with important domain changes. Update TanStack Query after events; never optimistically declare a trade confirmed.

The proposal form offers a choice between one JPEG/PNG/WebP photo (5 MB input) and one available listing from the sender’s own shelf, plus a message. Express rejects combined photo/listing submissions and verifies current ownership and availability for selected shelf items. Trade-offer messages retain optional photos for older clients. Express uses the existing bounded Sharp processor, strips metadata, and stores the processed WebP (at most 2 MB) in the private `message_photos` table, atomically with the message. This initial implementation keeps small attachments in PostgreSQL to avoid public media storage and orphaned uploads; only the authenticated Express photo endpoint may read them after checking current conversation access. Browser SDK roles have no attachment-table privileges. Retry keys bind to the message and source photo digest. New trade-offer messages also persist a server-validated `messages.proposal` snapshot (target listing ID/title, message, optional quality for older clients, and the selected offered listing ID/title when supplied) atomically with the message and photo. History and realtime carry this metadata so the conversation renders a proposal card without parsing ordinary chat text. Earlier messages without this metadata retain their original presentation. The recipient of a direct message proposal may accept or refuse it exactly once. `message_proposal_responses` stores an immutable decision, with current contact/membership checks, availability/staleness checks on acceptance, and a sender notification in the same transaction. Acceptance may include a future meetup instant, IANA time zone and public meeting place, saved atomically with the immutable decision and notification. These are recipient suggestions, not confirmation by the sender; participants confirm arrangements in chat. Matching retries return the saved decision; opposite decisions or changed meetup details conflict. Accepted message proposals appear for both participants in My Swaps and link to their private detail page at `/swaps/offers/:messageId`. Either current participant may arrange or edit its meetup through Express. A revision check prevents overwriting concurrent edits; persisted operation keys bind retries to the actor and exact input. Meetup updates, operation receipts and the other participant’s notification commit atomically; the acceptance decision and original response time remain unchanged. Changed arrangements remain suggestions requiring agreement in chat. They preserve the unlisted offer snapshot and do not fabricate inventory or reserve items; the existing versioned, reservation-based trade lifecycle remains separate. Response state and accepted-proposal pages are authorized Express reads and refresh through TanStack Query.

Allow up to three listing photos. Enforce byte, pixel, and processing-concurrency limits; decode and re-encode with Sharp, strip metadata, and store processed files only. Published listing photos/avatars are intentionally public; private content must never use a public bucket. Deny browser storage writes. Keep uploads off Render’s persistent filesystem assumptions; clean orphaned objects after failed operations.

## 8. Development, deployment, and operations

Run Supabase locally using its CLI and Docker-compatible runtime. Pin supported Node/pnpm versions and commit the lockfile. Document environment variables without secrets. Use synthetic seeds and isolated development/test/preview data by default. The owner explicitly authorized an additive production demo on 2026-10-08: use only the approved hosted targets, fresh synthetic identities, a separate private journal, authenticated Express actions and ordinary domain transitions; preserve existing records. See `DEMO.md`. Destructive seeds and production resets remain prohibited.

**Drizzle migrations are the only schema history**, including custom SQL for RLS, grants, triggers, and constraints.[^migrations] No undocumented dashboard edits or production schema-push commands. Use a small `pg` pool with verified TLS; use Supabase’s session pooler when IPv4 connectivity requires it.[^connections]

GitHub Actions: lint/typecheck → unit/component tests → local database + migrations → API/RLS tests → builds → critical Playwright tests. Protect `main`; restrict secrets, pin third-party actions, and review Dependabot updates.

Serialize releases: transactionally roll back a preflight of reviewed pending migrations → deploy the compatible API and verify its exact revision → apply the reviewed migrations → Cloudflare Pages upload through Wrangler → smoke tests. For the two-person removal, retire archived legacy records separately before preflight; the new API supports the old schema while it is being replaced.[^deploy] Verify the intended API revision is healthy; a deploy-hook response is insufficient. Separate destructive migrations; retain rollback-compatible application builds. Previews must not receive production credentials.

The hosted application has one production environment. Cloudflare Pages project `swapcircle` serves `https://swapcircle.pages.dev`. GitHub Actions uses the `production` environment for release credentials and serialized, explicitly dispatched releases of an exact checked revision. Push and pull-request checks do not deploy. The production Render service is `SwapCircle` (`srv-db1ioidg1s2s73acoel0`) at `https://swapcircle-wqu8.onrender.com`, in the Production environment of My project. It replaces `swapcircle-staging-api`; the existing Supabase project is retained. The API requires the `supabase-ca.crt` secret file mounted at `/etc/secrets/supabase-ca.crt` for verified database TLS. CORS and Supabase authentication redirects allow only the production frontend origin. Local development and isolated CI services remain separate from production.

Log request IDs and safe metadata with Pino. Use Sentry errors without session replay; redact tokens, message bodies, email addresses, and meeting details. Alert on errors and inspect storage, bandwidth, and realtime usage. Provide liveness/readiness endpoints and honest API-wakeup states.

Target **$0 within free allowances**, not unlimited availability. Render Free sleeps and has ephemeral storage; Supabase Free may pause and lacks included automatic backups.[^free] No keepalive workarounds or automatic paid add-ons. Export encrypted database backups and storage objects separately; test restoration.[^backups] Use Supabase Cron for cleanup when needed, never in-process timers as the authority for expiry.

## 9. Required acceptance tests and deferred scope

Before release, verify unauthorized reads/writes through both Express and direct Supabase access; forged identity fields; exactly-one versus two shared interests; independent coffee consent; direct-conversation isolation; blocked contact; stale acceptances; concurrent reservations; duplicate retries; partial-handover disputes; reconnect recovery; and logout cache clearing. Cover two-person trades and rejection of additional or replacement participants, migration replay, upload rejection, keyboard navigation, and automated accessibility checks.

Deferred: payments, shipping, automatic cycle discovery, AI matching, video and general chat attachments, Socket.IO, Redis/queues, presence indicators, and external venue/search services. Zustand, Turnstile, analytics, and email delivery are optional additions with an explicit need and cost review.

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
