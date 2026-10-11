import { ForwardIcon, LocationIcon } from '../../components/ui/icons';
import { Select } from '../../components/ui/select';
import { Link, useSearchParams } from 'react-router-dom';
import { memberQuerySchema } from '@swapcircle/contracts';
import { useMemberDiscovery } from './useMemberDiscovery';
import { useInterests } from '../account/useProfile';
import { Avatar } from '../account/Avatar';
import { Button } from '../../components/ui/button';
import { MessageAction } from '../inbox/MessageAction';
import { Card } from '../../components/ui/card';

export function MemberDiscovery() {
  const [params, setParams] = useSearchParams();
  const parsed = memberQuerySchema.safeParse({
    limit: 4,
    interest: params.get('interest') ?? undefined,
  });
  const query = parsed.success
    ? parsed.data
    : memberQuerySchema.parse({ limit: 4 });
  const interests = useInterests();
  const { members, personalized } = useMemberDiscovery(query, parsed.success);

  return (
    <>
      <p>
        {personalized
          ? 'Shared interests are a starting point. You can trade or message regardless of overlap.'
          : 'Meet members of your community. Sign in to see your shared interests.'}
      </p>
      <label className="member-interest-filter" htmlFor="discovery-interest">
        Discover by interest
        <Select
          id="discovery-interest"
          value={query.interest ?? ''}
          disabled={!interests.data}
          onChange={(event) => {
            const next = new URLSearchParams(params);
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
                  <div className="member-preview-header">
                    <Avatar name={member.displayName} url={member.avatarUrl} />
                    <div className="member-preview-identity">
                      <h3>
                        <Link to={`/members/${member.id}`}>
                          {member.displayName}
                        </Link>
                      </h3>
                      <p className="member-preview-location">
                        <LocationIcon size={16} aria-hidden="true" />
                        {member.approximateLocation || 'Location not shared'}
                      </p>
                    </div>
                  </div>
                  <div className="member-preview-interests">
                    <p className="member-preview-interest-label">
                      {member.sharedInterestCount === null
                        ? 'Interests'
                        : `${member.sharedInterestCount} shared ${member.sharedInterestCount === 1 ? 'interest' : 'interests'}`}
                    </p>
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
                  </div>
                  <div className="member-preview-actions">
                    <Button asChild variant="ghost">
                      <Link to={`/members/${member.id}`}>
                        View profile
                        <ForwardIcon size={16} aria-hidden="true" />
                      </Link>
                    </Button>
                    <MessageAction userId={member.id} />
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <p>No members match these interests yet.</p>
          )}
        </>
      )}
    </>
  );
}
