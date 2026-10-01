import type { PoolClient } from 'pg';

// Acquire before account, listing, trade and conversation locks. A listing can
// belong to several proposals; this short boundary prevents discovery/creation
// races and lock inversions when invalidating all of them in one transaction.
export async function lockProposalBoundary(client: PoolClient) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('proposal-terms', 0))",
  );
}
