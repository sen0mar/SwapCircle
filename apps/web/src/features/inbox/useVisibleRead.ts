import { useEffect, useRef, useState, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MessageRead } from '@swapcircle/contracts';
import { useAuth } from '../auth/AuthProvider';
import { acknowledgeRead } from './inbox-api';

// Observe rendered bubbles inside both the scroll region and the browser viewport.
// Mounting a preview, loading history, or receiving an event is never an acknowledgement.
export function useVisibleRead(
  id: string,
  viewport: RefObject<HTMLDivElement | null>,
  messages: MessageRead[],
  enabled: boolean,
) {
  const { session, request, readSignal } = useAuth();
  const queries = useQueryClient();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const saved = useRef(0);
  const userId = session?.user.id;
  const signature = messages
    .map((message) => `${message.id}:${message.message_order}`)
    .join(',');

  useEffect(() => {
    const root = viewport.current;
    if (!root || !enabled || !userId) return;
    const lifetime = new AbortController();
    const signal = AbortSignal.any([readSignal, lifetime.signal]);
    let queued: { id: string; order: number } | undefined;
    let running = false;
    let failed = false;
    let flush: ReturnType<typeof setTimeout> | undefined;

    const persist = async () => {
      if (running || failed || !queued || signal.aborted) return;
      running = true;
      try {
        while (queued && !signal.aborted) {
          const target = queued;
          queued = undefined;
          const state = await acknowledgeRead(request, id, target.id, signal);
          signal.throwIfAborted();
          saved.current = Math.max(saved.current, state.lastViewedOrder);
          setError(false);
          await queries.invalidateQueries({
            queryKey: ['private', userId, 'inbox'],
          });
        }
      } catch {
        if (!signal.aborted) {
          failed = true;
          setError(true);
        }
      } finally {
        running = false;
      }
    };
    const inspect = () => {
      if (
        document.visibilityState !== 'visible' ||
        signal.aborted ||
        root.closest('[aria-hidden="true"], [inert]')
      )
        return;
      const bounds = root.getBoundingClientRect();
      for (const bubble of root.querySelectorAll<HTMLElement>(
        '[data-message-id]',
      )) {
        const rect = bubble.getBoundingClientRect();
        const order = Number(bubble.dataset.messageOrder);
        // A bubble must have actual visible area; CSS-hidden/mobile list and hidden
        // tabs have none. Never acknowledge a newly appended offscreen bubble.
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > Math.max(bounds.top, 0) &&
          rect.top < Math.min(bounds.bottom, innerHeight) &&
          rect.right > 0 &&
          rect.left < innerWidth &&
          order > saved.current &&
          order > (queued?.order ?? 0)
        )
          queued = { id: bubble.dataset.messageId!, order };
      }
      if (queued) {
        clearTimeout(flush);
        // Coalesce a burst of displayed messages into one private write. Never
        // spend the contact-action burst allowance on every Realtime frame.
        flush = setTimeout(() => void persist(), 250);
      }
    };
    const reconnect = () => {
      failed = false;
      inspect();
    };
    const observer = new IntersectionObserver(inspect, {
      threshold: [0, 0.01, 1],
    });
    root
      .querySelectorAll('[data-message-id]')
      .forEach((bubble) => observer.observe(bubble));
    const modalVisibility = new MutationObserver(inspect);
    modalVisibility.observe(document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ['aria-hidden', 'inert'],
    });
    const frame = requestAnimationFrame(inspect);
    root.addEventListener('scroll', inspect);
    globalThis.addEventListener('scroll', inspect);
    globalThis.addEventListener('resize', inspect);
    globalThis.addEventListener('online', reconnect);
    document.addEventListener('visibilitychange', inspect);

    return () => {
      lifetime.abort();
      clearTimeout(flush);
      observer.disconnect();
      modalVisibility.disconnect();
      cancelAnimationFrame(frame);
      root.removeEventListener('scroll', inspect);
      globalThis.removeEventListener('scroll', inspect);
      globalThis.removeEventListener('resize', inspect);
      globalThis.removeEventListener('online', reconnect);
      document.removeEventListener('visibilitychange', inspect);
    };
    // A stable position signature avoids restarting on profile/local composer renders.
  }, [
    id,
    viewport,
    signature,
    enabled,
    userId,
    request,
    readSignal,
    queries,
    attempt,
  ]);

  return { error, retry: () => setAttempt((value) => value + 1) };
}
