import type { ReactNode } from 'react';
import {
  ForwardIcon,
  ListingsIcon,
  AddIcon,
  CommunityIcon,
} from '../../components/ui/icons';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import cafe from '../../assets/cafe.jpg';
export interface HomeContentProps {
  listingContent: ReactNode;
  memberContent: ReactNode;
}

export function HomeContent({
  listingContent,
  memberContent,
}: HomeContentProps) {
  return (
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
            <Button asChild>
              <Link to="/listings/new">
                <AddIcon size={20} aria-hidden="true" />
                List an item
              </Link>
            </Button>
            <Button asChild variant="primary">
              <Link to="/browse">
                Browse items
                <ForwardIcon size={20} aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
        <img
          className="hero-photo"
          src={cafe}
          alt=""
          width="1000"
          height="667"
        />
      </section>
      <section
        className="home-listings-section"
        aria-labelledby="featured-title"
      >
        <div className="section-heading">
          <div className="home-section-title">
            <span className="home-section-icon" aria-hidden="true">
              <ListingsIcon size={24} />
            </span>
            <h2 id="featured-title">Featured listings</h2>
          </div>
          <Link to="/browse">
            Browse items <ForwardIcon size={16} aria-hidden="true" />
          </Link>
        </div>
        {listingContent}
      </section>
      <section
        className="home-community-section"
        aria-labelledby="members-title"
      >
        <div className="section-heading">
          <div className="home-section-title">
            <span className="home-section-icon" aria-hidden="true">
              <CommunityIcon size={24} />
            </span>
            <h2 id="members-title">Discover your community</h2>
          </div>
          <Link to="/community">
            View all members <ForwardIcon size={16} aria-hidden="true" />
          </Link>
        </div>
        {memberContent}
      </section>
    </div>
  );
}
