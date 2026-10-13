import { ForwardIcon, LocationIcon } from '../../components/ui/icons';
import { useEffect, useRef } from 'react';
import { Input } from '../../components/ui/input';
import { Link, useSearchParams } from 'react-router-dom';
import { memberQuerySchema } from '@swapcircle/contracts';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { Avatar } from '../account/Avatar';
import { useInterests } from '../account/useProfile';
import { MessageAction } from '../inbox/MessageAction';
import { useMemberDiscovery } from '../home/useMemberDiscovery';

export function CommunityPage() {
  const [params, setParams] = useSearchParams();
  const searchForm = useRef<HTMLFormElement>(null);
  const search = params.toString();

  useEffect(() => {
    const reset = () => searchForm.current?.reset();
    reset();
    const restore = () => window.setTimeout(reset, 0);
    window.addEventListener('pageshow', restore);
    window.addEventListener('popstate', restore);

    return () => {
      window.removeEventListener('pageshow', restore);
      window.removeEventListener('popstate', restore);
    };
  }, [search]);

  const parsed = memberQuerySchema.safeParse({
    ...Object.fromEntries(params),
    limit: 20,
  });
  const query = parsed.success
    ? parsed.data
    : memberQuerySchema.parse({ limit: 20 });
  const interests = useInterests();
  const { members, personalized } = useMemberDiscovery(query, parsed.success);

  const pageLink = (cursor?: string) => {
    const next = new URLSearchParams(params);
    next.delete('cursor');
    if (cursor) next.set('cursor', cursor);

    return `/community${next.size ? `?${next}` : ''}`;
  };

  return (
    <section className="community-page" aria-label="Community">
      <h1 className="sr-only">Community</h1>
      <div className="community-filters">
        <form
          ref={searchForm}
          key={search}
          className="community-name-search"
          onSubmit={(event) => {
            event.preventDefault();
            const name = String(
              new FormData(event.currentTarget).get('q') ?? '',
            ).trim();
            const next = new URLSearchParams(params);
            next.delete('cursor');
            if (name) next.set('q', name);
            else next.delete('q');

            setParams(next);
          }}
        >
          <label htmlFor="community-search">
            Search by name
            <Input
              id="community-search"
              name="q"
              type="search"
              maxLength={120}
              defaultValue={params.get('q') ?? ''}
              placeholder="Enter a member’s name"
            />
          </label>
          <Button type="submit">Search</Button>
        </form>
        <label className="member-interest-filter" htmlFor="community-interest">
          Search by interest
          <Select
            id="community-interest"
            value={query.interest ?? ''}
            disabled={!interests.data}
            onChange={(event) => {
              const next = new URLSearchParams(params);
              next.delete('cursor');
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
          </Select>
        </label>
        {(query.q || query.interest) && (
          <Link to="/community">Clear filters</Link>
        )}
      </div>
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
          These community filters are invalid.{' '}
          <Link to="/community">Clear filters</Link>
        </p>
      ) : members.isPending ? (
        <p role="status">Loading members…</p>
      ) : members.isError ? (
        <div className="panel route-panel">
          <p role="alert">
            Members could not be loaded. Check your connection and try again.
          </p>
          <Button onClick={() => void members.refetch()}>Retry members</Button>
          {query.cursor && (
            <Link to={pageLink()}>Start from the first page</Link>
          )}
        </div>
      ) : (
        <>
          {members.data.items.length ? (
            <ul
              className="community-member-list"
              aria-label="Community members"
            >
              {members.data.items.map((member) => (
                <li key={member.id} className="community-member-card ui-card">
                  <div className="community-member-identity">
                    <Avatar name={member.displayName} url={member.avatarUrl} />
                    <div>
                      <h2>
                        <Link to={`/members/${member.id}`}>
                          {member.displayName}
                        </Link>
                      </h2>
                      <p className="member-preview-location">
                        <LocationIcon size={16} aria-hidden="true" />
                        {member.approximateLocation || 'Location not shared'}
                      </p>
                    </div>
                  </div>
                  <div className="community-member-interests">
                    <p className="member-preview-interest-label">
                      {personalized
                        ? `${member.sharedInterestCount ?? 0} shared ${member.sharedInterestCount === 1 ? 'interest' : 'interests'}`
                        : 'Interests'}
                    </p>
                    {member.interests.length ? (
                      <ul
                        className="interest-list"
                        aria-label={`${member.displayName} interests`}
                      >
                        {member.interests.map((interest) => (
                          <li key={interest.id} className="interest-chip">
                            {interest.name}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="community-member-empty">
                        No interests shared yet.
                      </p>
                    )}
                  </div>
                  <div className="community-member-actions">
                    <Button asChild variant="ghost">
                      <Link to={`/members/${member.id}`}>
                        View profile
                        <ForwardIcon size={16} aria-hidden="true" />
                      </Link>
                    </Button>
                    <MessageAction userId={member.id} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="panel route-panel">
              <h2>No members to show yet</h2>
              <p>Try another name or interest, or browse all members.</p>
              <Link to="/community">Clear filters</Link>
            </div>
          )}
          <nav className="catalog-pagination" aria-label="Community pages">
            {query.cursor && <Link to={pageLink()}>First page</Link>}
            {members.data.nextCursor && (
              <Link to={pageLink(members.data.nextCursor)}>Next page</Link>
            )}
          </nav>
        </>
      )}
    </section>
  );
}
