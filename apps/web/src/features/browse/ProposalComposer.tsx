import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ImagePlus, X } from 'lucide-react';
import {
  messageReceiptSchema,
  offeredItemConditionSchema,
  type Listing,
  type TradeMessageSubmission,
} from '@swapcircle/contracts';
import { Select } from '../../components/ui/select';
import { conditions } from './ListingContent';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog';
import { useAuth } from '../auth/AuthProvider';
import { ProposalTermsEditor } from './ProposalTermsEditor';

// Saved formal proposals retain their existing revision behavior.
export function ProposalComposer(
  props: ComponentProps<typeof ProposalTermsEditor>,
) {
  if (props.revision) return <ProposalTermsEditor {...props} />;

  return <TradeMessageComposer item={props.item!} />;
}

function TradeMessageComposer({ item }: { item: Listing }) {
  const { session, request } = useAuth();
  const queries = useQueryClient();
  const navigate = useNavigate();
  const trigger = useRef<HTMLButtonElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const pending = useRef<{
    body: string;
    photo: File | null;
    condition: TradeMessageSubmission['condition'];
    payload: TradeMessageSubmission;
  } | null>(null);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [condition, setCondition] =
    useState<TradeMessageSubmission['condition']>();
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!photo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const send = useMutation({
    mutationFn: async () => {
      if (
        !pending.current ||
        pending.current.body !== body ||
        pending.current.photo !== photo ||
        pending.current.condition !== condition
      ) {
        const photoBase64 = photo
          ? await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve(String(reader.result).split(',')[1]!);
              reader.onerror = () =>
                reject(
                  new Error(
                    'The photo could not be read. Please choose it again.',
                  ),
                );
              reader.readAsDataURL(photo);
            })
          : undefined;
        pending.current = {
          body,
          photo,
          condition,
          payload: {
            listingId: item.id,
            body: body.trim(),
            ...(condition ? { condition } : {}),
            clientMessageId: crypto.randomUUID(),
            ...(photoBase64 ? { photoBase64 } : {}),
          },
        };
      }

      return request('/api/v1/conversations/proposals', messageReceiptSchema, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending.current.payload),
        timeoutMs: 45000,
      });
    },
    onSuccess: (message) => {
      setOpen(false);
      setBody('');
      setCondition(undefined);
      setPhoto(null);
      pending.current = null;
      void queries.invalidateQueries({
        queryKey: ['private', session?.user.id, 'inbox'],
      });
      void queries.invalidateQueries({
        queryKey: [
          'private',
          session?.user.id,
          'thread',
          message.conversation_id,
        ],
      });
      void navigate(`/inbox/${message.conversation_id}`);
    },
    onError: (cause) =>
      setError(
        cause instanceof Error
          ? cause.message
          : 'Your message could not be sent. Your draft is kept.',
      ),
  });

  if (
    !session ||
    session.user.id === item.ownerId ||
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
        onOpenChange={(next) => {
          if (!send.isPending) setOpen(next);
        }}
      >
        <DialogContent
          className="trade-message-dialog"
          aria-describedby={undefined}
          closeDisabled={send.isPending}
          onCloseAutoFocus={() => trigger.current?.focus()}
        >
          <DialogTitle className="proposal-title">Propose a trade</DialogTitle>
          <form
            className="trade-message-form"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              send.mutate();
            }}
          >
            <div className="trade-message-field">
              <label htmlFor="trade-message">Your message</label>
              <textarea
                id="trade-message"
                autoFocus
                required
                maxLength={4500}
                rows={6}
                value={body}
                disabled={send.isPending}
                placeholder="Hi! What would you like to offer in exchange?"
                onChange={(event) => {
                  setBody(event.target.value);
                  setError(null);
                }}
              />
            </div>
            <section
              className="trade-offer-section"
              aria-labelledby="trade-offer-heading"
            >
              <h3 id="trade-offer-heading">The item you’re offering</h3>
              <div className="trade-message-photo">
                <div className="trade-field-heading">
                  <span>
                    Item photo{' '}
                    <span className="trade-field-optional">(optional)</span>
                  </span>
                </div>
                {preview && (
                  <div className="trade-photo-preview">
                    <img src={preview} alt="Your trade offer" />
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label="Remove photo"
                      disabled={send.isPending}
                      onClick={() => {
                        setPhoto(null);
                        setError(null);
                      }}
                    >
                      <X size={18} aria-hidden="true" />
                    </Button>
                  </div>
                )}
                <input
                  ref={upload}
                  id="trade-photo"
                  aria-label="Photo of your trade offer"
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  tabIndex={-1}
                  disabled={send.isPending}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    if (
                      !['image/jpeg', 'image/png', 'image/webp'].includes(
                        file.type,
                      ) ||
                      file.size > 5 * 1024 * 1024 ||
                      !file.size
                    ) {
                      setError('Choose a JPEG, PNG, or WebP photo up to 5 MB.');
                      return;
                    }
                    setPhoto(file);
                    setError(null);
                  }}
                />
                <Button
                  type="button"
                  disabled={send.isPending}
                  aria-describedby="trade-photo-help"
                  onClick={() => upload.current?.click()}
                >
                  <ImagePlus size={18} aria-hidden="true" />
                  {photo
                    ? 'Change photo of your item'
                    : 'Add a photo of your item'}
                </Button>
                <p id="trade-photo-help">JPEG, PNG or WebP · up to 5 MB</p>
              </div>
              <div className="trade-message-field trade-quality-field">
                <label htmlFor="trade-item-quality">
                  Item quality{' '}
                  <span className="trade-field-optional">(optional)</span>
                </label>
                <Select
                  id="trade-item-quality"
                  className="ui-button ui-button-secondary"
                  value={condition ?? ''}
                  disabled={send.isPending}
                  onChange={(event) => {
                    const selected = offeredItemConditionSchema.safeParse(
                      event.target.value,
                    );
                    setCondition(selected.success ? selected.data : undefined);
                    setError(null);
                  }}
                >
                  <option value="">Select item quality</option>
                  {offeredItemConditionSchema.options.map((value) => (
                    <option key={value} value={value}>
                      {conditions[value]}
                    </option>
                  ))}
                </Select>
              </div>
            </section>
            {error && (
              <p role="alert" className="ui-feedback-error">
                {error}
              </p>
            )}
            <div className="trade-message-actions">
              <Button
                type="submit"
                variant="primary"
                disabled={send.isPending || !body.trim()}
              >
                {send.isPending ? 'Sending…' : 'Send proposal'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
