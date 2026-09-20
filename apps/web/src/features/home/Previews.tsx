import { useId, useState } from 'react';
import { ImageOff, MapPin, MessageCircle, UserRound } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';

export function InterestChip({ children }: { children: string }) {
  return <span className="interest-chip">{children}</span>;
}

export interface Member {
  name: string;
  location: string;
  interests: readonly string[];
}

export function MemberIdentity({ member }: { member: Member }) {
  return (
    <div className="member-identity">
      <span className="member-avatar" aria-hidden="true">
        <UserRound size={22} />
      </span>
      <div>
        <p className="member-name">{member.name}</p>
        <p className="member-location">{member.location}</p>
      </div>
    </div>
  );
}

export function MessageUnavailable() {
  const id = useId();
  return (
    <div className="message-action">
      <Button disabled aria-describedby={id}>
        <MessageCircle size={16} aria-hidden="true" />
        Message
      </Button>
      <p id={id}>Messaging is not available yet.</p>
    </div>
  );
}

export function MemberPreview({ member }: { member: Member }) {
  return (
    <Card className="member-preview">
      <MemberIdentity member={member} />
      <div className="interest-list">
        {member.interests.map((interest) => (
          <InterestChip key={interest}>{interest}</InterestChip>
        ))}
      </div>
      <MessageUnavailable />
    </Card>
  );
}

export interface Listing {
  title: string;
  condition: string;
  owner: Member;
  photo: string;
  photoAlt: string;
}

export function ListingCard({ listing }: { listing: Listing }) {
  const [failed, setFailed] = useState(false);
  return (
    <Card className="listing-card">
      <article>
        {failed ? (
          <div className="photo-unavailable">
            <ImageOff aria-hidden="true" />
            <span>Photo unavailable</span>
          </div>
        ) : (
          <img
            className="listing-photo"
            src={listing.photo}
            alt={listing.photoAlt}
            width="500"
            height="375"
            onError={() => setFailed(true)}
          />
        )}
        <div className="listing-copy">
          <h3>{listing.title}</h3>
          <p>{listing.condition}</p>
          <p className="listing-owner">{listing.owner.name}</p>
          <p className="location">
            <MapPin size={14} aria-hidden="true" />
            {listing.owner.location}
          </p>
          <div className="interest-list">
            {listing.owner.interests.map((interest) => (
              <InterestChip key={interest}>{interest}</InterestChip>
            ))}
          </div>
        </div>
      </article>
    </Card>
  );
}

export interface Conversation {
  member: Member;
  preview: string;
}

export function ConversationPreview({
  conversation,
}: {
  conversation: Conversation;
}) {
  return (
    <li className="conversation-preview">
      <MemberIdentity member={conversation.member} />
      <p>{conversation.preview}</p>
    </li>
  );
}

export type CollectionState = 'loading' | 'empty' | 'unavailable';
export function CollectionNotice({
  state,
  subject,
}: {
  state: CollectionState;
  subject: string;
}) {
  return (
    <Card className="collection-notice">
      <p role={state === 'loading' ? 'status' : undefined}>
        {state === 'loading'
          ? `Loading ${subject}…`
          : state === 'empty'
            ? `No ${subject} to show yet.`
            : `${subject[0]?.toUpperCase()}${subject.slice(1)} are not available yet.`}
      </p>
      {state === 'loading' && (
        <div className="quiet-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
    </Card>
  );
}
