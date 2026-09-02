/**
 * Pointer-based drag and drop for cards and columns.
 *
 * A drag starts once the pointer moves a few pixels with the button held.
 * While dragging, the source element is hidden and a placeholder occupies the
 * prospective drop slot. Targets are computed from live DOM geometry with a
 * count-of-midpoints rule, which is stable under placeholder insertion, and
 * the board scroller auto-scrolls near its edges.
 *
 * Indices follow remove-then-insert semantics: the index addresses the list
 * as it looks without the dragged item, matching the moveCard and
 * reorderColumn ops.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export interface CardDropTarget {
  columnId: string;
  index: number;
}

export type DragState =
  | {
      kind: 'card';
      cardId: string;
      fromColumnId: string;
      fromIndex: number;
      width: number;
      height: number;
      pointerX: number;
      pointerY: number;
      grabX: number;
      grabY: number;
      target: CardDropTarget | null;
    }
  | {
      kind: 'column';
      columnId: string;
      fromIndex: number;
      width: number;
      height: number;
      pointerX: number;
      pointerY: number;
      grabX: number;
      grabY: number;
      targetIndex: number | null;
    };

interface DndOptions {
  scrollerRef: RefObject<HTMLDivElement | null>;
  onMoveCard(cardId: string, toColumnId: string, toIndex: number): void;
  onReorderColumn(columnId: string, toIndex: number): void;
}

interface Session {
  kind: 'card' | 'column';
  id: string;
  fromColumnId: string;
  fromIndex: number;
  startX: number;
  startY: number;
  grabX: number;
  grabY: number;
  width: number;
  height: number;
  pointerX: number;
  pointerY: number;
  active: boolean;
  cardTarget: CardDropTarget | null;
  columnTarget: number | null;
}

const ACTIVATION_DISTANCE = 5;
const EDGE_ZONE = 56;
const MAX_SCROLL_STEP = 16;

function isInteractive(element: EventTarget | null): boolean {
  return (
    element instanceof HTMLElement &&
    element.closest('button, input, textarea, select, a, [contenteditable="true"]') !== null
  );
}

export function useDnd(options: DndOptions) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const session = useRef<Session | null>(null);
  const raf = useRef<number | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  /** True from drag activation until after the click event that follows the drop. */
  const didDrag = useRef(false);

  const columnElements = useCallback((): HTMLElement[] => {
    const scroller = optionsRef.current.scrollerRef.current;
    if (!scroller) return [];
    return [...scroller.querySelectorAll<HTMLElement>('[data-column-id]')];
  }, []);

  const computeCardTarget = useCallback(
    (s: Session): CardDropTarget | null => {
      const columns = columnElements();
      if (columns.length === 0) return null;

      let best: HTMLElement | null = null;
      let bestDistance = Infinity;
      for (const el of columns) {
        const rect = el.getBoundingClientRect();
        if (s.pointerX >= rect.left && s.pointerX <= rect.right) {
          best = el;
          break;
        }
        const distance = Math.min(
          Math.abs(s.pointerX - rect.left),
          Math.abs(s.pointerX - rect.right),
        );
        if (distance < bestDistance) {
          bestDistance = distance;
          best = el;
        }
      }
      if (!best) return null;
      const columnId = best.dataset['columnId'];
      if (!columnId) return null;

      const items = [...best.querySelectorAll<HTMLElement>('[data-card-id]')].filter(
        (el) => el.dataset['cardId'] !== s.id,
      );
      let index = 0;
      for (const el of items) {
        const rect = el.getBoundingClientRect();
        if (rect.top + rect.height / 2 < s.pointerY) index += 1;
      }
      return { columnId, index };
    },
    [columnElements],
  );

  const computeColumnTarget = useCallback(
    (s: Session): number => {
      const columns = columnElements().filter((el) => el.dataset['columnId'] !== s.id);
      let index = 0;
      for (const el of columns) {
        const rect = el.getBoundingClientRect();
        if (rect.left + rect.width / 2 < s.pointerX) index += 1;
      }
      return index;
    },
    [columnElements],
  );

  const publish = useCallback((s: Session) => {
    if (s.kind === 'card') {
      setDrag({
        kind: 'card',
        cardId: s.id,
        fromColumnId: s.fromColumnId,
        fromIndex: s.fromIndex,
        width: s.width,
        height: s.height,
        pointerX: s.pointerX,
        pointerY: s.pointerY,
        grabX: s.grabX,
        grabY: s.grabY,
        target: s.cardTarget,
      });
    } else {
      setDrag({
        kind: 'column',
        columnId: s.id,
        fromIndex: s.fromIndex,
        width: s.width,
        height: s.height,
        pointerX: s.pointerX,
        pointerY: s.pointerY,
        grabX: s.grabX,
        grabY: s.grabY,
        targetIndex: s.columnTarget,
      });
    }
  }, []);

  const retarget = useCallback(
    (s: Session) => {
      if (s.kind === 'card') s.cardTarget = computeCardTarget(s);
      else s.columnTarget = computeColumnTarget(s);
      publish(s);
    },
    [computeCardTarget, computeColumnTarget, publish],
  );

  const autoScroll = useCallback(() => {
    const s = session.current;
    const scroller = optionsRef.current.scrollerRef.current;
    if (!s || !s.active || !scroller) {
      raf.current = null;
      return;
    }

    let scrolled = false;
    const rect = scroller.getBoundingClientRect();
    if (s.pointerX < rect.left + EDGE_ZONE) {
      const strength = (rect.left + EDGE_ZONE - s.pointerX) / EDGE_ZONE;
      scroller.scrollLeft -= Math.ceil(strength * MAX_SCROLL_STEP);
      scrolled = true;
    } else if (s.pointerX > rect.right - EDGE_ZONE) {
      const strength = (s.pointerX - rect.right + EDGE_ZONE) / EDGE_ZONE;
      scroller.scrollLeft += Math.ceil(strength * MAX_SCROLL_STEP);
      scrolled = true;
    }

    if (s.kind === 'card' && s.cardTarget) {
      const column = columnElements().find(
        (el) => el.dataset['columnId'] === s.cardTarget?.columnId,
      );
      const list = column?.querySelector<HTMLElement>('[data-cardlist]');
      if (list) {
        const listRect = list.getBoundingClientRect();
        if (s.pointerY < listRect.top + EDGE_ZONE) {
          list.scrollTop -= 10;
          scrolled = true;
        } else if (s.pointerY > listRect.bottom - EDGE_ZONE) {
          list.scrollTop += 10;
          scrolled = true;
        }
      }
    }

    if (scrolled) retarget(s);
    raf.current = requestAnimationFrame(autoScroll);
  }, [columnElements, retarget]);

  const endDrag = useCallback(
    (commit: boolean) => {
      const s = session.current;
      session.current = null;
      if (raf.current !== null) {
        cancelAnimationFrame(raf.current);
        raf.current = null;
      }
      document.body.classList.remove('is-dragging');
      setDrag(null);
      if (!s || !s.active || !commit) return;

      if (s.kind === 'card' && s.cardTarget) {
        const { columnId, index } = s.cardTarget;
        if (columnId !== s.fromColumnId || index !== s.fromIndex) {
          optionsRef.current.onMoveCard(s.id, columnId, index);
        }
      } else if (s.kind === 'column' && s.columnTarget !== null) {
        if (s.columnTarget !== s.fromIndex) {
          optionsRef.current.onReorderColumn(s.id, s.columnTarget);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const s = session.current;
      if (!s) return;
      s.pointerX = e.clientX;
      s.pointerY = e.clientY;

      if (!s.active) {
        const distance = Math.hypot(e.clientX - s.startX, e.clientY - s.startY);
        if (distance < ACTIVATION_DISTANCE) return;
        s.active = true;
        didDrag.current = true;
        document.body.classList.add('is-dragging');
        raf.current = requestAnimationFrame(autoScroll);
      }
      retarget(s);
    };

    const onUp = () => {
      if (session.current) endDrag(true);
      // Let the click event that follows pointerup read didDrag, then reset.
      setTimeout(() => {
        didDrag.current = false;
      }, 0);
    };

    const onCancel = () => {
      if (session.current) endDrag(false);
      didDrag.current = false;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [autoScroll, endDrag, retarget]);

  const beginSession = useCallback(
    (
      e: React.PointerEvent,
      kind: 'card' | 'column',
      id: string,
      fromColumnId: string,
      fromIndex: number,
    ) => {
      if (e.button !== 0 || isInteractive(e.target)) return;
      const rect = e.currentTarget.getBoundingClientRect();
      session.current = {
        kind,
        id,
        fromColumnId,
        fromIndex,
        startX: e.clientX,
        startY: e.clientY,
        grabX: e.clientX - rect.left,
        grabY: e.clientY - rect.top,
        width: rect.width,
        height: rect.height,
        pointerX: e.clientX,
        pointerY: e.clientY,
        active: false,
        cardTarget: kind === 'card' ? { columnId: fromColumnId, index: fromIndex } : null,
        columnTarget: kind === 'column' ? fromIndex : null,
      };
    },
    [],
  );

  const onCardPointerDown = useCallback(
    (e: React.PointerEvent, cardId: string, columnId: string, index: number) => {
      beginSession(e, 'card', cardId, columnId, index);
    },
    [beginSession],
  );

  const onColumnPointerDown = useCallback(
    (e: React.PointerEvent, columnId: string, index: number) => {
      beginSession(e, 'column', columnId, columnId, index);
    },
    [beginSession],
  );

  return { drag, onCardPointerDown, onColumnPointerDown, didDrag };
}
