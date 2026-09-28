import { Link, useSearchParams } from 'react-router-dom';
import { memberQuerySchema } from '@swapcircle/contracts';
import { useMemberDiscovery } from './useMemberDiscovery';
import { useInterests } from '../account/useProfile';
import { Avatar } from '../account/Avatar';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';

export function MemberDiscovery() {
  const [params, setParams] = useSearchParams();
  const parsed = memberQuerySchema.safeParse({
    limit: 4,
    interest: params.get('interest') ?? undefined,
    cursor: params.get('memberCursor') ?? undefined,
  });
  const query = parsed.success
    ? parsed.data
    : memberQuerySchema.parse({ limit: 4 });
  const interests = useInterests();
  const { members, personalized } = useMemberDiscovery(query, parsed.success);

  const pageLink = (cursor?: string) => {
    const next = new URLSearchParams(params);
    next.delete('memberCursor');
    if (cursor) next.set('memberCursor', cursor);
    return `/?${next}`;
  };

  return (
    <>
      <p>
        {personalized
          ? 'Shared interests are a starting point. You can trade or message regardless of overlap.'
          : 'Meet members of your community. Sign in to see your shared interests.'}
      </p>
      <label className="member-interest-filter" htmlFor="discovery-interest">
        Discover by interest
        <select
          id="discovery-interest"
          value={query.interest ?? ''}
          disabled={!interests.data}
          onChange={(event) => {
            const next = new URLSearchParams(params);
            next.delete('memberCursor');
            if (event.target.value) next.set('interest', event.target.value);
            else next.delete('interest');
            setParams(next);
          }}
        >
          <option value="">All interests</option>
          {interests.data?.map((interest) => (
            <option key={interest.id} value={interest.id}>
              {interest.name}
            </option>
          ))}
        </select>
      </label>
      {interests.isError && (
        <p role="alert">
          Interest filters could not be loaded.{' '}
          <Button onClick={() => void interests.refetch()}>
            Retry interests
          </Button>
        </p>
      )}
      {!parsed.success ? (
        <p role="alert">
          These discovery filters are invalid.{' '}
          <Link to="/">Clear discovery filters</Link>
        </p>
      ) : members.isPending ? (
        <p role="status">Loading members…</p>
      ) : members.isError ? (
        <div className="panel route-panel">
          <p role="alert">
            Members could not be loaded. Check your connection and try again.
          </p>
          <Button onClick={() => void members.refetch()}>Retry members</Button>
        </div>
      ) : (
        <>
          {members.data.items.length ? (
            <div className="member-grid">
              {members.data.items.map((member) => (
                <Card key={member.id} className="member-preview">
                  <Avatar name={member.displayName} url={member.avatarUrl} />
                  <h3>
                    <Link to={`/members/${member.id}`}>
                      {member.displayName}
                    </Link>
                  </h3>
                  <p>{member.approximateLocation || 'Location not shared'}</p>
                  {member.sharedInterestCount !== null && (
                    <p>
                      {member.sharedInterestCount} shared{' '}
                      {member.sharedInterestCount === 1
                        ? 'interest'
                        : 'interests'}
                    </p>
                  )}
                  <ul
                    className="interest-list"
                    aria-label={`${member.displayName} interests`}
                  >
                    {(member.sharedInterestCount === null
                      ? member.interests
                      : member.sharedInterests
                    ).map((interest) => (
                      <li className="interest-chip" key={interest.id}>
                        {interest.name}
                      </li>
                    ))}
                  </ul>
                  <Link to={`/members/${member.id}`}>View profile</Link>
                </Card>
              ))}
            </div>
          ) : (
            <p>No members match these interests yet.</p>
          )}
          <nav
            className="catalog-pagination"
            aria-label="Member discovery pages"
          >
            {query.cursor && <Link to={pageLink()}>First members</Link>}
            {members.data.nextCursor && (
              <Link to={pageLink(members.data.nextCursor)}>More members</Link>
            )}
          </nav>
        </>
      )}
    </>
  );
}
