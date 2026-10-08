# Demo community

The app uses real persisted records and ordinary Supabase sessions for the demo. The seed is an explicit operation, separate from migration-only `db:seed` and CI fixtures.

## Setup

Use the pinned Node and pnpm versions. Start the existing isolated local Supabase stack and apply migrations through the documented local database workflow. Do not reset existing data. Then run from the repository root:

```sh
pnpm demo:seed
pnpm --filter @swapcircle/api dev
pnpm dev
```

Both web and API `.env` files must point to the local stack (`127.0.0.1:55431`); the API database must use the isolated runtime role on port 55432. The API development command sets `NODE_ENV=development`. No hosted configuration changes are required. If the server was already running, restart it after the new code is built.

On `/sign-in`, choose **Continue as guest**. It opens the shared **Camille Demo** account through a normal Supabase session. All visitors to this local demo account share its shelf, conversations, swaps and edits. Use fictional details only. Google and password sign-in remain available. Other synthetic users can sign in through the form using the owner-readable credentials in `packages/database/.demo.local/credentials.json`; do not publish that file or paste it into logs/issues.

Guest access uses the same form and Supabase SDK lifecycle in development and production. The API requires either the isolated development stack or explicit server-only production guest credentials on the exact approved project. It refuses unapproved origins, limits session requests, returns `Cache-Control: no-store`, checks the seeded identity, and keeps passwords server-side. Production additionally requires a server-owned completed-seed marker; an ordinary production API without guest configuration has no guest route.

## Demo tour

- **Home and Browse:** ten fictional Paris neighbours, 32 listings, photographed covers and four multi-image bundles. Most items remain available. Search for books, plants or a camera; try a condition or availability filter.
- **Member and listing pages:** complete biographies, approximate locations, avatars, interests and other items from the owner. Photos are illustrative stock images, and every listing identifies itself as fictional.
- **My Shelf:** ten items owned by Camille, with available, reserved and exchanged examples. Open an available item in the editor to explore the normal form and gallery.
- **My Swaps:** nine scenarios, including an incoming camera proposal, an outgoing music proposal, confirmed plants, completed books, a cancelled guitar exchange, a disputed bicycle exchange and three group proposals. Separate items keep reservations consistent.
- **Swap details:** real transition histories, accepted terms, receipt acknowledgements, pairwise coffee consent, private fictional meetings and a three-person transfer cycle. Coffee eligibility uses the existing interest catalogue. No invented statistics or environmental impact are inserted.
- **Inbox:** five short direct conversations and two accepted group conversations, including read and unread activity.
- **Notifications and group invitations:** domain-generated read/unread notifications link to real records; one group invitation remains pending for Camille to accept.
- **Profile, account and settings:** the normal signed-in experience. Sign out and use another local demo user's form credentials to check account isolation.

New proposals expire 28 days after the initial seed; meetings are set seven days after it in Europe/Paris. Rerunning does not refresh dates or undo user interactions. Completed and disputed swaps are historical demonstrations, not real exchanges.

## Resuming and preserving data

The seed checks `NODE_ENV`, the exact Auth/runtime database targets, CLI project identity, and all bundled assets before creating users or records. It creates only accounts with synthetic `example.invalid` identities and server-owned demo metadata; it refuses collisions. App records, photos and transitions use authenticated Express endpoints and normal authorization, quotas, transactions, events and notifications. No application SQL writes, RLS bypass, schema push or resets are involved.

An ignored, private journal saves intent before writes and records completed operations. Domain operation keys and message IDs stay stable on retries. Listing/profile/photo creation recovers saved results through authorized reads. Completed actions are skipped, never reapplied; changed manifests are refused. A rerun preserves subsequent edits and may report changed or unavailable records instead of repairing them. The seed deliberately pauses writes to respect existing burst limits.

Run `pnpm demo:seed` again after a failure to resume. Preserve `.demo.local/`: losing it loses the operation keys and account passwords, so the runner refuses to adopt unrelated records. A lock prevents concurrent runs. If a process was forcibly killed, confirm that no seed is running before removing only `.demo.local/seed.lock`. Never delete trade history or disable append-only triggers to clean up a demo.

The bundled image sources and license are recorded in `packages/database/demo/`. Runtime seeding reads those local files, processes them through Sharp, uploads to local Storage and verifies image responses before enabling guest access.

## Verification

With the seed and both development servers running, `pnpm --filter @swapcircle/web test:demo-local` checks public photos, guest login/reload, private page coverage, group invitations, notifications, profile/editor/settings, logout and a second user's password form login. It also checks the sign-in form at narrow/wide widths with axe. It reads only the ignored local demo credentials and deliberately avoids printing secrets or private page text. Public screenshots are saved under the ignored web test-results directory. Opening an inbox thread can mark synthetic messages read, as normal browsing does.

## Production

The owner authorized an additive production demo on 2026-10-08. Production uses the existing Supabase project `tpanyqfgmbpsiejqjocd`, API `https://swapcircle-wqu8.onrender.com` and frontend `https://swapcircle.pages.dev`. Local commands still refuse hosted targets. There are no resets, deletions, schema changes or direct application database writes.

The separately guarded hosted command requires the ignored root `.env.hosted` server credentials, verified database CA, exact least-privilege runtime role, explicit authorization and the actual deployed API revision:

```sh
NODE_ENV=production DEMO_SEED_AUTHORIZATION=approved-production-demo DEMO_API_REVISION=<verified-live-api-sha> pnpm demo:seed:production
```

Run only after verifying `/api/v1/ready` and hosted password-provider configuration. It uses the deployed Express API for all domain writes and a read-only TLS database connection for pre-existing row fingerprints. Production accounts use a separate synthetic namespace and fresh passwords. Credentials, journal, lock, baseline and the guest secret are isolated in ignored `packages/database/.demo.hosted.local/`; never copy local credentials to production. Completed reruns preserve interactions. Changed pre-existing rows stop verification for inspection rather than triggering repair or rollback.

After all app records and images are verified, the runner marks only its synthetic guest identity ready and writes `guest.json`. Set its JSON contents as the Render server-only `DEMO_GUEST_CREDENTIALS` secret on the existing service. Do not print it, commit it, or use a `VITE_*` variable. Removing the server secret disables the route. The shared guest account is intentionally editable and visible to other visitors; use fictional details only.

Release code through the existing exact-revision GitHub checks and controlled migration/API/Pages workflow. A populated database does not deploy the UI or API. CI billing failures are not successful checks and must be resolved before releasing. Verify both deployed revisions, photos, password login, guest reload and private pages after release.
