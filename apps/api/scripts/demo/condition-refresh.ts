import type { Listing } from '@swapcircle/contracts';
import type { DemoListing } from './manifest.ts';

export function prepareConditionChange(
  current: Listing,
  saved: Listing,
  desired: DemoListing,
  ownerId: string,
) {
  if (
    current.id !== saved.id ||
    current.ownerId !== ownerId ||
    saved.ownerId !== ownerId
  )
    throw new Error('Demo ownership mismatch.');

  if (
    current.title === desired.title &&
    current.description === desired.description &&
    current.condition === desired.condition
  )
    return null;

  if (
    current.availability !== 'available' ||
    current.title !== saved.title ||
    current.description !== saved.description ||
    current.condition !== saved.condition ||
    current.revision !== saved.revision
  )
    throw new Error(
      'A demo listing was edited or frozen; refusing to overwrite it.',
    );

  return {
    title: desired.title,
    description: desired.description,
    condition: desired.condition,
    revision: current.revision,
  };
}
