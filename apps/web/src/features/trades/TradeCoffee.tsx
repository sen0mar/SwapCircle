import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { ApiError } from '../../lib/api-client';
import { useAuth } from '../auth/AuthProvider';
import type { TradeDetail } from './trades-api';
import { useCoffee, useCoffeeAction, useCoffeeEligibility } from './useCoffee';

function CoffeePair({
  detail,
  inviteeId,
  name,
}: {
  detail: TradeDetail;
  inviteeId: string;
  name: string;
}) {
  const { session } = useAuth();
  const eligibility = useCoffeeEligibility(detail.id, inviteeId);
  const coffee = useCoffee(detail.id);
  const action = useCoffeeAction(detail.id);
  const [selected, setSelected] = useState(false);
  const [offer, setOffer] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const [attempt, setAttempt] = useState<
    Parameters<typeof action.mutate>[0] | null
  >(null);
  const actor = session?.user.id;
  const active = coffee.data?.find(
    (i) =>
      ['pending', 'accepted'].includes(i.status) &&
      [i.inviterId, i.inviteeId].includes(actor ?? '') &&
      [i.inviterId, i.inviteeId].includes(inviteeId),
  );
  const available = ['proposed', 'confirmed'].includes(detail.status);
  const error = action.error;
  const definitive =
    error instanceof ApiError &&
    error.status !== undefined &&
    error.status >= 400 &&
    error.status < 500;
  const uncertain = !!error && !definitive;
  const busy = action.isPending || uncertain;
  const invitationCurrent =
    !coffee.isError && !coffee.isFetching && !coffee.isPending;
  const current =
    invitationCurrent &&
    !eligibility.isError &&
    !eligibility.isFetching &&
    !eligibility.isPending;

  function submit(input: Parameters<typeof action.mutate>[0]) {
    setAttempt(input);
    action.mutate(input, {
      onSuccess: () => {
        setSelected(false);
        setOffer(false);
        setAttempt(null);
        heading.current?.focus();
      },
    });
  }

  return (
    <section className="coffee-pair" aria-label={`Coffee with ${name}`}>
      <h3 ref={heading} tabIndex={-1}>
        You and {name}
      </h3>
      {eligibility.isPending ? (
        <p role="status">Checking shared interests…</p>
      ) : eligibility.isError ? (
        <p role="alert">
          Coffee eligibility could not be verified. Refresh to check current
          access and interests.
        </p>
      ) : (
        <>
          <p>
            Shared interests:{' '}
            {eligibility.data.sharedInterests.length ? '' : 'none'}
          </p>
          <ul
            className="interest-list"
            aria-label={`Shared interests with ${name}`}
          >
            {eligibility.data.sharedInterests.map((i) => (
              <li className="interest-chip" key={i.id}>
                {i.name}
              </li>
            ))}
          </ul>
          {!eligibility.data.eligible && (
            <p>
              At least two shared interests are needed for a new coffee
              invitation. You can still meet to swap.
            </p>
          )}
        </>
      )}
      {active ? (
        <>
          <p role="status">
            {active.status === 'accepted'
              ? `Coffee agreed: you and ${name}.`
              : active.inviteeId === actor
                ? `${name} invited you. Your coffee response is pending.`
                : `You invited ${name}. Their coffee response is pending.`}
          </p>
          {active.offerToPay && (
            <p>
              {active.inviterId === actor ? 'You offered' : `${name} offered`}{' '}
              to pay for coffee in person.
            </p>
          )}
          {active.status === 'pending' && active.inviteeId === actor && (
            <div className="coffee-actions">
              <Button
                variant="primary"
                disabled={
                  busy || !current || !eligibility.data?.eligible || !available
                }
                onClick={() => submit({ id: active.id, action: 'accept' })}
              >
                Accept coffee
              </Button>
              <Button
                variant="secondary"
                disabled={busy || !invitationCurrent}
                onClick={() => submit({ id: active.id, action: 'decline' })}
              >
                Decline coffee
              </Button>
            </div>
          )}
          {(active.status === 'accepted' || active.inviterId === actor) && (
            <Button
              variant="secondary"
              disabled={busy || !invitationCurrent}
              onClick={() => submit({ id: active.id, action: 'cancel' })}
            >
              Cancel coffee
            </Button>
          )}
        </>
      ) : (
        <>
          <fieldset disabled={busy}>
            <legend>Optional coffee with {name}</legend>
            <label>
              <input
                type="radio"
                name={`coffee-${inviteeId}`}
                checked={!selected}
                onChange={() => {
                  setSelected(false);
                  setOffer(false);
                }}
              />{' '}
              Meet to swap
            </label>
            {current && eligibility.data?.eligible && available && (
              <label>
                <input
                  type="radio"
                  name={`coffee-${inviteeId}`}
                  checked={selected}
                  onChange={() => setSelected(true)}
                />{' '}
                Swap + coffee
              </label>
            )}
          </fieldset>
          {selected && current && eligibility.data?.eligible && available && (
            <>
              <label className="coffee-offer">
                <input
                  type="checkbox"
                  checked={offer}
                  disabled={busy}
                  onChange={(e) => setOffer(e.target.checked)}
                />{' '}
                Coffee on me
              </label>
              <p>An optional offer to pay in person.</p>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  submit({
                    send: {
                      inviteeId,
                      offerToPay: offer,
                      operationKey: crypto.randomUUID(),
                    },
                  })
                }
              >
                Send coffee invitation
              </Button>
            </>
          )}
          {selected &&
            (!current || !eligibility.data?.eligible || !available) && (
              <p role="status">
                Your coffee selection is preserved. A new invitation requires
                current eligibility and an open swap.
              </p>
            )}
        </>
      )}
      {action.isPending && <p role="status">Saving coffee response…</p>}
      {error && (
        <div>
          <p role="alert">
            {error instanceof ApiError && error.code === 'COFFEE_INELIGIBLE'
              ? 'Shared interests changed. Coffee requires two current shared interests. Your selection is preserved.'
              : definitive
                ? 'This coffee action could not be saved. Review the refreshed invitation and eligibility before trying again.'
                : 'The coffee outcome could not be verified. Your input is preserved. Retry the same action to safely check its outcome.'}{' '}
            Trade agreement is separate.
          </p>
          {uncertain && attempt && (
            <Button disabled={action.isPending} onClick={() => submit(attempt)}>
              Retry coffee action
            </Button>
          )}
        </div>
      )}
      <Button
        variant="secondary"
        disabled={action.isPending}
        onClick={() => {
          void eligibility.refetch();
          void coffee.refetch();
        }}
      >
        Refresh coffee with {name}
      </Button>
    </section>
  );
}

export function TradeCoffee({ detail }: { detail: TradeDetail }) {
  const { session } = useAuth();
  const coffee = useCoffee(detail.id);
  const names = new Map(
    detail.participants.map((p) => [p.userId, p.displayName]),
  );

  return (
    <section
      id="coffee"
      className="panel route-panel"
      aria-label="Coffee invitations"
    >
      <h2>Optional coffee</h2>
      <p>
        Meet to swap is the default. Coffee needs a separate invitation and
        consent from each pair. Declining or cancelling coffee leaves the swap
        agreement unchanged.
      </p>
      {coffee.isPending && <p role="status">Loading coffee invitations…</p>}
      {coffee.isError && (
        <div>
          <p role="alert">
            Coffee invitations could not be refreshed. Refresh before
            responding.
          </p>
          <Button onClick={() => void coffee.refetch()}>
            Retry coffee invitations
          </Button>
        </div>
      )}
      {detail.participants
        .filter((p) => p.userId !== session?.user.id)
        .map((p) => (
          <CoffeePair
            key={p.userId}
            detail={detail}
            inviteeId={p.userId}
            name={p.displayName}
          />
        ))}
      <h3>Pair responses</h3>
      {coffee.data?.length ? (
        <ul>
          {coffee.data.map((i) => (
            <li key={i.id}>
              {names.get(i.inviterId) ?? 'Former participant'} →{' '}
              {names.get(i.inviteeId) ?? 'Former participant'} ·{' '}
              {i.status === 'accepted'
                ? 'Both agreed to coffee'
                : i.status === 'pending'
                  ? 'Invitation pending; no agreement yet'
                  : `Coffee ${i.status}`}
              {i.offerToPay
                ? ` · ${names.get(i.inviterId) ?? 'Inviter'} offered to pay in person`
                : ''}
            </li>
          ))}
        </ul>
      ) : (
        !coffee.isPending &&
        !coffee.isError && (
          <p>No coffee invitations yet. No participant has agreed to coffee.</p>
        )
      )}
    </section>
  );
}
