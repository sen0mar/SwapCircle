import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { getPublicProfile } from './profile-api';
import { MemberListings } from '../browse/MemberListings';
import { SafetyActions } from '../safety/SafetyActions';
import { Avatar } from './Avatar';

export function MemberPage() {
  const { id = '' } = useParams();
  const member = useQuery({
    queryKey: ['member', id],
    queryFn: ({ signal }) => getPublicProfile(id, signal),
    enabled: !!id,
    retry: false,
  });

  if (member.isPending) return <p role="status">Loading member…</p>;

  if (member.isError)
    return (
      <section className="panel route-panel">
        <h1>Member unavailable</h1>
        <p role="alert">This member could not be loaded.</p>
        <Button onClick={() => void member.refetch()}>Retry</Button>
      </section>
    );

  const profile = member.data;

  return (
    <section
      className="panel route-panel member-page"
      aria-labelledby="member-title"
    >
      <h1 id="member-title">{profile.displayName}</h1>
      <Avatar url={profile.avatarUrl} name={profile.displayName} />
      {profile.approximateLocation && <p>{profile.approximateLocation}</p>}
      <h2>About</h2>
      <p className="profile-biography-text">
        {profile.biography || 'No biography yet.'}
      </p>
      <h2>Interests</h2>
      {profile.interests.length ? (
        <ul className="interest-list" aria-label="Interests">
          {profile.interests.map((interest) => (
            <li className="interest-chip" key={interest.id}>
              {interest.name}
            </li>
          ))}
        </ul>
      ) : (
        <p>No interests added yet.</p>
      )}
      <SafetyActions
        key={id}
        userId={id}
        name={profile.displayName}
        targetType="member"
        targetId={id}
      />
      <h2>Listings</h2>
      <MemberListings owner={id} />
    </section>
  );
}
