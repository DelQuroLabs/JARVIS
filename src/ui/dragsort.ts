/**
 * Pointer-driven drag-to-reorder.
 *
 * Pointer events rather than HTML5 drag-and-drop, because HTML5 DnD does not
 * fire on touch at all and this app is mobile-first.
 *
 * Dragging only starts in an explicit rearrange mode. That is deliberate: on a
 * phone a tile is a navigation button, and a drag gesture that competes with a
 * tap is how you get accidental reorders and blocked page scrolling. In
 * rearrange mode the tiles set `touch-action: none`, so the browser hands us
 * the gesture instead of scrolling.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface DragSort {
  /** The id currently being dragged, or null. */
  dragId: string | null;
  /** The id the pointer is hovering, i.e. where it would land. */
  overId: string | null;
  /** Live pixel offset of the dragged tile from its origin. */
  offset: { x: number; y: number };
  /** Spread onto every sortable element. */
  itemProps: (id: string) => {
    'data-sortid': string;
    onPointerDown: (e: React.PointerEvent) => void;
  };
  containerProps: { ref: (el: HTMLDivElement | null) => void };
}

export function useDragSort(
  enabled: boolean,
  onDrop: (dragId: string, overId: string) => void,
): DragSort {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const container = useRef<HTMLDivElement | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const active = useRef<string | null>(null);
  const over = useRef<string | null>(null);

  const cleanup = useRef<(() => void) | null>(null);

  const stop = useCallback(
    (commit: boolean) => {
      cleanup.current?.();
      cleanup.current = null;
      const from = active.current;
      const to = over.current;
      active.current = null;
      over.current = null;
      setDragId(null);
      setOverId(null);
      setOffset({ x: 0, y: 0 });
      if (commit && from && to && from !== to) onDrop(from, to);
    },
    [onDrop],
  );

  // Detach on unmount so a drag interrupted by navigation cannot leak listeners.
  useEffect(() => () => cleanup.current?.(), []);

  const begin = useCallback(
    (id: string, x: number, y: number) => {
      start.current = { x, y };
      active.current = id;
      over.current = id;
      setDragId(id);
      setOverId(id);
      setOffset({ x: 0, y: 0 });

      // Listeners are attached synchronously rather than from an effect. An
      // effect only runs after the next render, and a fast drag can complete
      // before that -- the pointerup would then be missed and the tile would
      // stay stuck to the cursor.
      const move = (e: PointerEvent) => {
        setOffset({ x: e.clientX - start.current.x, y: e.clientY - start.current.y });
        const host = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-sortid]');
        const overId2 = host?.dataset.sortid ?? over.current;
        over.current = overId2 ?? null;
        setOverId(overId2 ?? null);
      };
      const up = () => stop(true);
      const cancel = () => stop(false);

      window.addEventListener('pointermove', move, { passive: true });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('blur', cancel);
      cleanup.current = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('blur', cancel);
      };
    },
    [stop],
  );

  const itemProps = useCallback(
    (id: string) => ({
      'data-sortid': id,
      onPointerDown: (e: React.PointerEvent) => {
        if (!enabled || e.button !== 0) return;
        begin(id, e.clientX, e.clientY);
      },
    }),
    [enabled, begin],
  );

  return {
    dragId,
    overId,
    offset,
    itemProps,
    containerProps: { ref: (el: HTMLDivElement | null) => { container.current = el; } },
  };
}
