import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { BlockAction } from './SafetyActions';
import { useBlocks } from './useSafety';

export function BlockedMembers() {
  const blocks = useBlocks();
  const items = blocks.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section
      className="blocked-members"
      aria-labelledby="blocked-members-title"
    >
      <h2 id="blocked-members-title" tabIndex={-1}>
        Blocked members
      </h2>
      <p>
        Manage your own blocks. Unblocking does not override other contact
        restrictions.
      </p>
      {blocks.isPending ? (
        <p role="status">Loading blocked members…</p>
      ) : blocks.isError ? (
        <div>
          <p role="alert">
            Blocked members could not be loaded. Check your connection and
            retry.
          </p>
          <Button onClick={() => void blocks.refetch()}>
            Retry blocked members
          </Button>
        </div>
      ) : (
        <>
          {!items.length && <p>No blocked members.</p>}
          <ul className="blocked-members-list">
            {items.map((member) => (
              <li key={member.userId}>
                <Link to={`/members/${member.userId}`}>
                  {member.displayName}
                </Link>
                <BlockAction
                  userId={member.userId}
                  name={member.displayName}
                  blocked
                  returnFocusId="blocked-members-title"
                />
              </li>
            ))}
          </ul>
          {blocks.hasNextPage && (
            <Button
              disabled={blocks.isFetchingNextPage}
              onClick={() => void blocks.fetchNextPage()}
            >
              {blocks.isFetchingNextPage ? 'Loading…' : 'More blocked members'}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
