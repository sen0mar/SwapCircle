import { ArrowRight, Leaf, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import cafe from '../../assets/cafe.jpg';
import {
  CollectionNotice,
  ConversationPreview,
  InterestChip,
  ListingCard,
  MemberPreview,
  MessageUnavailable,
  type CollectionState,
  type Conversation,
  type Listing,
  type Member,
} from './Previews';

export interface HomeContentProps {
  state?: CollectionState | 'ready';
  listings?: readonly Listing[];
  members?: readonly Member[];
  conversations?: readonly Conversation[];
}

export function HomeContent({
  state = 'unavailable',
  listings = [],
  members = [],
  conversations = [],
}: HomeContentProps) {
  const notice = state === 'ready' ? 'empty' : state;
  return (
    <div className="page-grid">
      <div className="home-main">
        <section className="hero home-hero" aria-labelledby="home-title">
          <div className="hero-copy">
            <h1 id="home-title">
              Less stuff.
              <br />
              <span className="text-brand-ink">More connection.</span>
            </h1>
            <p className="hero-description">
              SwapCircle helps you give, get and meet — for a more meaningful,
              less wasteful world.
            </p>
            <div className="hero-actions">
              <Button disabled aria-describedby="listing-unavailable">
                <Plus size={20} aria-hidden="true" />
                List an item
              </Button>
              <Button asChild variant="primary">
                <Link to="/browse">
                  Browse items
                  <ArrowRight size={20} aria-hidden="true" />
                </Link>
              </Button>
            </div>
            <p id="listing-unavailable" className="availability-note">
              Listing items will be available when sign-in is ready.
            </p>
          </div>
          <img
            className="hero-photo"
            src={cafe}
            alt=""
            width="1000"
            height="667"
          />
        </section>
        <section aria-labelledby="featured-title">
          <div className="section-heading">
            <h2 id="featured-title">Featured listings</h2>
            <Link to="/browse">
              Browse items <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          {state === 'ready' && listings.length ? (
            <>
              <div className="listing-grid">
                {listings.map((listing) => (
                  <ListingCard key={listing.title} listing={listing} />
                ))}
              </div>
              <p className="availability-note">
                Sample listings for design preview. Item details are not
                available yet.
              </p>
            </>
          ) : (
            <CollectionNotice state={notice} subject="listings" />
          )}
        </section>
        <section aria-labelledby="members-title">
          <div className="section-heading">
            <h2 id="members-title">Discover your community</h2>
          </div>
          {state === 'ready' && members.length ? (
            <div className="member-grid">
              {members.map((member) => (
                <MemberPreview key={member.name} member={member} />
              ))}
            </div>
          ) : (
            <CollectionNotice state={notice} subject="members" />
          )}
        </section>
      </div>
      <aside className="right-rail" aria-label="Community and conversations">
        <Card className="community-panel">
          <Leaf size={28} aria-hidden="true" className="text-brand-ink" />
          <h2>A little more community</h2>
          <p>Shared interests can be the start of a connection.</p>
          {state === 'ready' && members.length ? (
            <>
              <p>Sample interests from the preview community</p>
              <div className="interest-list">
                {Array.from(
                  new Set(members.flatMap((member) => member.interests)),
                ).map((interest) => (
                  <InterestChip key={interest}>{interest}</InterestChip>
                ))}
              </div>
              <MessageUnavailable />
            </>
          ) : (
            <p className="availability-note">
              Interest discovery is not available yet.
            </p>
          )}
        </Card>
        <section aria-labelledby="conversations-title">
          <div className="section-heading">
            <h2 id="conversations-title">Conversations</h2>
          </div>
          {state === 'ready' && conversations.length ? (
            <Card>
              <p className="preview-caption">Synthetic conversation previews</p>
              <ul>
                {conversations.map((conversation) => (
                  <ConversationPreview
                    key={conversation.member.name}
                    conversation={conversation}
                  />
                ))}
              </ul>
              <MessageUnavailable />
            </Card>
          ) : (
            <CollectionNotice state={notice} subject="conversations" />
          )}
        </section>
      </aside>
    </div>
  );
}
