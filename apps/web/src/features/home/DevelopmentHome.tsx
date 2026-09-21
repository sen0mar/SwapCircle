import { Link } from 'react-router-dom';
import { useState } from 'react';
import backpack from '../../assets/backpack.jpg';
import camera from '../../assets/camera.jpg';
import books from '../../assets/books.jpg';
import plant from '../../assets/plant.jpg';
import { HomeContent } from './HomeContent';
import type { CollectionState, Listing, Member } from './Previews';

const members: Member[] = [
  {
    name: 'Jamie Demo',
    location: 'San Francisco, CA',
    interests: ['Hiking', 'Outdoors'],
  },
  {
    name: 'Alex Demo',
    location: 'Oakland, CA',
    interests: ['Photography', 'Tech'],
  },
  {
    name: 'Priya Demo',
    location: 'Berkeley, CA',
    interests: ['Books', 'Learning'],
  },
  {
    name: 'Morgan Demo',
    location: 'San Francisco, CA',
    interests: ['Plants', 'Gardening'],
  },
];

const listings: Listing[] = [
  {
    title: 'Everyday backpack',
    condition: 'Good condition · Ready for a new outing',
    photo: backpack,
    photoAlt: 'Navy blue backpack with a front zip pocket',
    owner: members[0]!,
  },
  {
    title: 'Camera and lenses',
    condition: 'Good condition · A fresh perspective',
    photo: camera,
    photoAlt: 'Black camera with two spare lenses',
    owner: members[1]!,
  },
  {
    title: 'A shelf of stories',
    condition: 'Well loved · More chapters to share',
    photo: books,
    photoAlt: 'A row of paperback books',
    owner: members[2]!,
  },
  {
    title: 'Little potted cactus',
    condition: 'Healthy plant · Includes its pot',
    photo: plant,
    photoAlt: 'Green cactus in an orange pot',
    owner: members[3]!,
  },
];

const conversations = members.slice(0, 3).map((member) => ({
  member,
  preview: 'This is a sample conversation, not a real message.',
}));

type Preview = CollectionState | 'ready' | 'off';

export default function DevelopmentHome() {
  const [preview, setPreview] = useState<Preview>('off');

  return (
    <>
      <div className="development-preview">
        <Link to="/dev/api-status">Development API status</Link>
        <label htmlFor="home-preview">Development homepage preview</label>
        <select
          id="home-preview"
          value={preview}
          onChange={(event) => setPreview(event.target.value as Preview)}
        >
          <option value="off">Off — signed-out view</option>
          <option value="ready">Sample content</option>
          <option value="loading">Loading</option>
          <option value="empty">Empty</option>
          <option value="unavailable">Unavailable</option>
        </select>
        <p>Synthetic preview content. Messaging is not available yet.</p>
      </div>
      <HomeContent
        state={preview === 'off' ? 'unavailable' : preview}
        listings={listings}
        members={members}
        conversations={conversations}
      />
    </>
  );
}
