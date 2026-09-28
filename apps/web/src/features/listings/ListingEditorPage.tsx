import { actionError } from '../safety/action-error';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  listingCreateSchema,
  type Listing,
  type ListingCreate,
} from '@swapcircle/contracts';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ApiError } from '../../lib/api-client';
import { useAuth } from '../auth/AuthProvider';
import { conditions } from '../browse/ListingContent';
import { useListing } from '../browse/useListings';
import { useCreateListing, useEditListing } from './useMyListings';
import { ListingPhotosEditor } from './ListingPhotosEditor';

const empty: ListingCreate = { title: '', description: '', condition: 'good' };

export function ListingEditorPage() {
  const { id } = useParams();

  return id ? <EditListingPage id={id} /> : <ListingForm mode="create" />;
}

function EditListingPage({ id }: { id: string }) {
  const { session } = useAuth();
  const listing = useListing(id);

  if (listing.isPending) return <p role="status">Loading item…</p>;

  if (listing.isError)
    return (
      <section className="panel route-panel">
        <h1>Edit item</h1>
        <p role="alert">This item could not be loaded for editing.</p>
        <Button onClick={() => void listing.refetch()}>Retry</Button>
      </section>
    );

  if (
    listing.data.ownerId !== session?.user.id ||
    listing.data.availability !== 'available'
  )
    return (
      <section className="panel route-panel">
        <h1>Edit item</h1>
        <p>This item is unavailable for editing.</p>
        <Link to="/shelf">Back to My Shelf</Link>
      </section>
    );

  return (
    <ListingForm
      key={`${listing.data.id}-${listing.data.revision}`}
      mode="edit"
      listing={listing.data}
    />
  );
}

function ListingForm({
  mode,
  listing,
}: {
  mode: 'create' | 'edit';
  listing?: Listing;
}) {
  const navigate = useNavigate();
  const create = useCreateListing();
  const edit = useEditListing(listing?.id ?? '');
  const mutation = mode === 'create' ? create : edit;
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ListingCreate>({
    resolver: zodResolver(listingCreateSchema),
    defaultValues: listing
      ? {
          title: listing.title,
          description: listing.description,
          condition: listing.condition,
        }
      : empty,
  });

  return (
    <section className="panel route-panel listing-editor">
      <Link to="/shelf">Back to My Shelf</Link>
      {listing && <Link to={`/listings/${listing.id}`}>View item</Link>}
      <h1>{mode === 'create' ? 'List an item' : 'Edit item'}</h1>
      <p>Describe your item so another member knows what to expect.</p>
      <form
        className="profile-form"
        onSubmit={handleSubmit(async (values) => {
          try {
            const saved =
              mode === 'create'
                ? await create.mutateAsync(values)
                : await edit.mutateAsync({
                    ...values,
                    revision: listing!.revision,
                  });

            navigate(
              mode === 'create'
                ? `/listings/${saved.id}/edit`
                : `/listings/${saved.id}`,
            );
          } catch {
            // React Hook Form keeps the draft available for another attempt.
          }
        })}
      >
        <div className="profile-field">
          <label htmlFor="listing-title">Title</label>
          <Input
            id="listing-title"
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? 'listing-title-error' : undefined}
            {...register('title')}
          />
          {errors.title && (
            <p id="listing-title-error" role="alert">
              {errors.title.message}
            </p>
          )}
        </div>
        <div className="profile-field">
          <label htmlFor="listing-description">Description</label>
          <textarea
            id="listing-description"
            className="ui-input profile-biography"
            aria-invalid={!!errors.description}
            aria-describedby={
              errors.description ? 'listing-description-error' : undefined
            }
            {...register('description')}
          />
          {errors.description && (
            <p id="listing-description-error" role="alert">
              {errors.description.message}
            </p>
          )}
        </div>
        <fieldset className="listing-conditions">
          <legend>Condition</legend>
          {(Object.entries(conditions) as [Listing['condition'], string][]).map(
            ([value, label]) => (
              <label key={value}>
                <input type="radio" value={value} {...register('condition')} />
                {label}
              </label>
            ),
          )}
          {errors.condition && <p role="alert">{errors.condition.message}</p>}
        </fieldset>
        {mutation.isError && (
          <p role="alert">
            {mutation.error instanceof ApiError &&
            mutation.error.code === 'STALE_REVISION'
              ? 'This item changed since you opened it. Your draft is still here. Reload before saving again.'
              : `${actionError(mutation.error)} Your draft is still here.`}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={mutation.isPending}>
          {mutation.isPending
            ? 'Saving…'
            : mode === 'create'
              ? 'Create item'
              : 'Save item'}
        </Button>
      </form>
      {listing ? (
        <ListingPhotosEditor listingId={listing.id} title={listing.title} />
      ) : (
        <p>Create the item to add up to three photos.</p>
      )}
    </section>
  );
}
