import { zodResolver } from '@hookform/resolvers/zod';
import {
  profileUpdateSchema,
  type CurrentProfile,
  type Interest,
} from '@swapcircle/contracts';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useCurrentProfile, useInterests, useSaveProfile } from './useProfile';
import { AvatarEditor } from './AvatarEditor';

export function ProfilePage() {
  const profile = useCurrentProfile();
  const interests = useInterests();

  if (profile.isPending) return <p role="status">Loading your profile…</p>;

  if (profile.isError)
    return (
      <section className="panel route-panel">
        <h1>Your profile</h1>
        <p role="alert">Your profile could not be loaded.</p>
        <Button onClick={() => void profile.refetch()}>Retry</Button>
      </section>
    );

  return (
    <section className="panel route-panel profile-page">
      <h1>Your profile</h1>
      <p>Choose what other members can see about you.</p>
      <ProfileForm
        key={profile.data.id}
        profile={profile.data}
        interests={interests.data ?? []}
        interestsAvailable={!interests.isError}
      />
      <AvatarEditor profile={profile.data} />
      {interests.isError && (
        <div>
          <p role="alert">
            Interests could not be loaded. Retry before changing your interests.
          </p>
          <Button onClick={() => void interests.refetch()}>
            Retry interests
          </Button>
        </div>
      )}
      <Link to={`/members/${profile.data.id}`}>View public profile</Link>
    </section>
  );
}

function ProfileForm({
  profile,
  interests,
  interestsAvailable,
}: {
  profile: CurrentProfile;
  interests: Interest[];
  interestsAvailable: boolean;
}) {
  const save = useSaveProfile();
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
    watch,
    setValue,
  } = useForm({
    resolver: zodResolver(profileUpdateSchema),
    defaultValues: {
      displayName: profile.displayName,
      biography: profile.biography,
      approximateLocation: profile.approximateLocation,
      interestIds: profile.interests.map((interest) => interest.id),
    },
  });
  const selected = watch('interestIds');

  return (
    <form
      className="profile-form"
      onSubmit={handleSubmit(async (values) => {
        try {
          const saved = await save.mutateAsync(values);
          reset({
            displayName: saved.displayName,
            biography: saved.biography,
            approximateLocation: saved.approximateLocation,
            interestIds: saved.interests.map((interest) => interest.id),
          });
        } catch {
          // Keep React Hook Form's draft intact for retry.
        }
      })}
    >
      <div className="profile-field">
        <label htmlFor="display-name">Display name</label>
        <Input
          id="display-name"
          aria-invalid={!!errors.displayName}
          aria-describedby={
            errors.displayName ? 'display-name-error' : undefined
          }
          {...register('displayName')}
        />
        {errors.displayName && (
          <p id="display-name-error" role="alert">
            {errors.displayName.message}
          </p>
        )}
      </div>
      <div className="profile-field">
        <label htmlFor="biography">Biography</label>
        <textarea
          id="biography"
          className="ui-input profile-biography"
          aria-invalid={!!errors.biography}
          aria-describedby={errors.biography ? 'biography-error' : undefined}
          {...register('biography')}
        />
        {errors.biography && (
          <p id="biography-error" role="alert">
            {errors.biography.message}
          </p>
        )}
      </div>
      <div className="profile-field">
        <label htmlFor="approximate-location">Approximate location</label>
        <Input
          id="approximate-location"
          aria-invalid={!!errors.approximateLocation}
          aria-describedby={
            errors.approximateLocation
              ? 'approximate-location-error'
              : 'location-hint'
          }
          {...register('approximateLocation')}
        />
        <p id="location-hint">
          Use a city or area. Do not enter an exact address.
        </p>
        {errors.approximateLocation && (
          <p id="approximate-location-error" role="alert">
            {errors.approximateLocation.message}
          </p>
        )}
      </div>
      <fieldset className="profile-interests">
        <legend>Interests</legend>
        {interests.length === 0 ? (
          <p>No interests are available yet.</p>
        ) : (
          interests.map((interest) => (
            <label key={interest.id}>
              <input
                type="checkbox"
                checked={selected.includes(interest.id)}
                onChange={(event) =>
                  setValue(
                    'interestIds',
                    event.target.checked
                      ? [...selected, interest.id]
                      : selected.filter((id) => id !== interest.id),
                    { shouldDirty: true, shouldValidate: true },
                  )
                }
              />
              {interest.name}
            </label>
          ))
        )}
        {errors.interestIds && <p role="alert">{errors.interestIds.message}</p>}
      </fieldset>
      {save.isError && (
        <p role="alert">
          Your changes could not be saved. Your draft is still here; retry when
          ready.
        </p>
      )}
      {save.isSuccess && !isDirty && <p role="status">Profile saved.</p>}
      <Button
        type="submit"
        variant="primary"
        disabled={save.isPending || !isDirty || !interestsAvailable}
      >
        {save.isPending ? 'Saving…' : 'Save profile'}
      </Button>
    </form>
  );
}
