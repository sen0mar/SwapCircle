import type { AcceptedProposalPage } from '@swapcircle/contracts';
import { ArrowRight, ArrowRightLeft, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { conditions } from '../browse/ListingContent';
import { ListingImage, useListingPhotos } from '../browse/listing-photos';
import { MessagePhoto } from '../inbox/ProposalMessageCard';

export function AcceptedSwapCard({
  item,
  userId,
}: {
  item: AcceptedProposalPage['items'][number];
  userId: string | undefined;
}) {
  const { message } = item;
  const proposal = message.proposal!;
  const isSender = message.sender_id === userId;
  const otherName = isSender ? item.recipientName : item.senderName;
  const photos = useListingPhotos(proposal.listingId);

  return (
    <Card className="swap-card">
      <div className="swap-card-header">
        <div className="swap-card-label">
          <ArrowRightLeft size={20} aria-hidden="true" />
          <h2>Item swap</h2>
        </div>
        <span className="swap-status swap-status-accepted">Accepted</span>
      </div>
      <p className="swap-card-meta">
        <span>
          <Users size={16} aria-hidden="true" />
          With {otherName}
        </span>
      </p>
      <ul className="swap-items">
        <li className="swap-item">
          <div className="swap-item-photo">
            <ListingImage
              photo={photos.data?.[0]}
              title={proposal.listingTitle}
            />
          </div>
          <div className="swap-item-copy">
            <span className="swap-item-direction">
              {isSender ? 'You receive' : 'You give'}
            </span>
            <h3>
              <Link to={`/listings/${proposal.listingId}`}>
                {proposal.listingTitle}
              </Link>
            </h3>
          </div>
        </li>
        <li className="swap-item">
          {message.has_photo && (
            <div className="swap-item-photo">
              <MessagePhoto id={message.id} />
            </div>
          )}
          <div className="swap-item-copy">
            <span className="swap-item-direction">
              {isSender ? 'You give' : 'You receive'}
            </span>
            <h3>Offered item</h3>
            <p>{proposal.message}</p>
            {proposal.condition && <p>{conditions[proposal.condition]}</p>}
          </div>
        </li>
      </ul>
      <div className="swap-card-footer">
        <Button asChild>
          <Link to={`/inbox/${message.conversation_id}`}>
            Open swap conversation
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </Card>
  );
}
