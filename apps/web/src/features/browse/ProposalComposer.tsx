import { useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  messageReceiptSchema,
  tradeMessageSubmissionSchema,
  type Listing,
  type TradeMessageSubmission,
} from '@swapcircle/contracts';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui/dialog';
import { useAuth } from '../auth/AuthProvider';
import { getListings } from './listing-api';
import { ListingImage, useListingPhotos } from './listing-photos';

function ShelfItem({
  item,
  selected,
  onSelect,
}: {
  item: Listing;
  selected: boolean;
  onSelect: () => void;
}) {
  const photos = useListingPhotos(item.id);

  return (
    <label className="proposal-choice proposal-shelf-item">
      <input
        type="radio"
        name="offered-item"
        checked={selected}
        onChange={onSelect}
      />
      <ListingImage photo={photos.data?.[0]} title={item.title} />
      <span>{item.title}</span>
    </label>
  );
}

function MessageProposalComposer({
  item,
  ownerName,
}: {
  item: Listing;
  ownerName: string;
}) {
  const { session, request } = useAuth();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const trigger = useRef<HTMLButtonElement>(null);
  const selectionVersion = useRef(0);
  const retry = useRef<TradeMessageSubmission | null>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'photo' | 'shelf'>('photo');
  const [body, setBody] = useState('');
  const [selected, setSelected] = useState('');
  const [photo, setPhoto] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const shelf = useInfiniteQuery({
    queryKey: ['private', session?.user.id, 'proposal-shelf'],
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) =>
      getListings(
        {
          owner: session!.user.id,
          availability: 'available',
          cursor: pageParam,
          limit: 50,
        },
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: open && mode === 'shelf' && !!session,
    retry: false,
  });
  const send = useMutation({
    mutationFn: (input: TradeMessageSubmission) =>
      request('/api/v1/conversations/proposals', messageReceiptSchema, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
  });

  async function choosePhoto(file?: File) {
    const version = ++selectionVersion.current;
    setPhoto('');
    setError('');
    setReading(false);
    if (!file) return;
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setError('Choose a JPEG, PNG or WebP photo up to 5 MB.');
      return;
    }
    setReading(true);
    const reader = new FileReader();
    reader.onload = () => {
      if (selectionVersion.current !== version) return;
      setPhoto(String(reader.result));
      setReading(false);
    };
    reader.onerror = () => {
      if (selectionVersion.current !== version) return;
      setError('The photo could not be read. Choose it again.');
      setReading(false);
    };
    reader.readAsDataURL(file);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (reading || send.isPending) return;
    if (mode === 'photo' ? !photo : !selected) {
      setError(
        mode === 'photo'
          ? 'Upload a photo of the item you want to trade.'
          : 'Choose an item from your shelf.',
      );
      return;
    }
    const content = {
      listingId: item.id,
      body: body.trim(),
      ...(mode === 'photo'
        ? { photoBase64: photo.split(',')[1] }
        : { offeredListingId: selected }),
    };
    const previous = retry.current;
    const input = {
      ...content,
      clientMessageId:
        previous &&
        previous.listingId === content.listingId &&
        previous.body === content.body &&
        previous.offeredListingId ===
          ('offeredListingId' in content
            ? content.offeredListingId
            : undefined) &&
        previous.photoBase64 ===
          ('photoBase64' in content ? content.photoBase64 : undefined)
          ? previous.clientMessageId
          : crypto.randomUUID(),
    };
    const parsed = tradeMessageSubmissionSchema.safeParse(input);
    if (!parsed.success) {
      setError('Add a message and choose an item or photo.');
      return;
    }
    retry.current = parsed.data;
    setError('');
    try {
      const saved = await send.mutateAsync(parsed.data);
      void queries.invalidateQueries({
        queryKey: ['private', session?.user.id, 'inbox'],
      });
      setOpen(false);
      setBody('');
      setPhoto('');
      setSelected('');
      retry.current = null;
      void navigate(`/inbox/${saved.conversation_id}`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The proposal could not be sent. Your draft is kept; try again.',
      );
    }
  }

  if (
    !session ||
    item.ownerId === session.user.id ||
    item.availability !== 'available'
  )
    return null;

  return (
    <div className="message-action">
      <Button ref={trigger} variant="primary" onClick={() => setOpen(true)}>
        Propose a trade
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!send.isPending) setOpen(value);
        }}
      >
        <DialogContent
          className="simple-proposal"
          closeDisabled={send.isPending}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <DialogTitle>Propose a trade</DialogTitle>
          <DialogDescription>
            Offer an item for {ownerName}’s {item.title}.
          </DialogDescription>
          <form
            className="simple-proposal-form"
            onSubmit={(event) => void submit(event)}
          >
            <fieldset disabled={send.isPending}>
              <legend>What would you like to trade?</legend>
              <div className="proposal-source-options">
                <label>
                  <input
                    type="radio"
                    name={`${id}-source`}
                    checked={mode === 'photo'}
                    onChange={() => {
                      setMode('photo');
                      setError('');
                    }}
                  />
                  Upload a photo
                </label>
                <label>
                  <input
                    type="radio"
                    name={`${id}-source`}
                    checked={mode === 'shelf'}
                    onChange={() => {
                      setMode('shelf');
                      setError('');
                    }}
                  />
                  Choose from my shelf
                </label>
              </div>
              {mode === 'photo' ? (
                <div>
                  <label htmlFor={`${id}-photo`}>Item photo</label>
                  <Input
                    id={`${id}-photo`}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    aria-describedby={`${id}-photo-help`}
                    onChange={(event) =>
                      void choosePhoto(event.target.files?.[0])
                    }
                  />
                  <p id={`${id}-photo-help`}>JPEG, PNG or WebP, up to 5 MB.</p>
                  {reading && <p role="status">Loading photo…</p>}
                  {photo && (
                    <img
                      className="proposal-upload-preview"
                      src={photo}
                      alt="Your offered item"
                    />
                  )}
                </div>
              ) : (
                <div className="proposal-shelf-list">
                  {shelf.isPending && <p role="status">Loading your items…</p>}
                  {shelf.isError && (
                    <div>
                      <p role="alert">Your items could not be loaded.</p>
                      <Button onClick={() => void shelf.refetch()}>
                        Retry items
                      </Button>
                    </div>
                  )}
                  {shelf.isSuccess &&
                    !shelf.data.pages.some((page) => page.items.length) && (
                      <p>
                        No available items on your shelf. Upload a photo
                        instead.
                      </p>
                    )}
                  {shelf.data?.pages
                    .flatMap((page) => page.items)
                    .map((entry) => (
                      <ShelfItem
                        key={entry.id}
                        item={entry}
                        selected={selected === entry.id}
                        onSelect={() => {
                          setSelected(entry.id);
                          setError('');
                        }}
                      />
                    ))}
                  {shelf.hasNextPage && (
                    <Button
                      disabled={shelf.isFetchingNextPage}
                      onClick={() => void shelf.fetchNextPage()}
                    >
                      More items
                    </Button>
                  )}
                </div>
              )}
              <label htmlFor={`${id}-message`}>Message</label>
              <textarea
                className="ui-input"
                id={`${id}-message`}
                rows={4}
                required
                maxLength={4500}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Tell them about your item and suggest a trade…"
              />
            </fieldset>
            {error && <p role="alert">{error}</p>}
            <Button
              type="submit"
              variant="primary"
              disabled={send.isPending || reading}
            >
              {send.isPending ? 'Sending…' : 'Send proposal'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ProposalComposer(props: { item: Listing; ownerName: string }) {
  const { session } = useAuth();

  return (
    <MessageProposalComposer
      key={session?.user.id ?? 'signed-out'}
      {...props}
    />
  );
}
