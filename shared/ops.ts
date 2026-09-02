/**
 * Pure op application and validation.
 *
 * This module is the single source of truth for board mutations. The server
 * uses it to validate and apply intents; the client uses the exact same code
 * for optimistic application, which is what makes both sides converge.
 *
 * applyOp never mutates its input. It returns either a new state or a
 * rejection reason. It does not touch state.version; the caller decides how
 * versions advance (the server bumps by one per accepted op).
 */

import type { BoardState, Card, Op, RejectReason } from './types.js';
import { LIMITS } from './types.js';

export type ApplyResult =
  | { ok: true; state: BoardState }
  | { ok: false; reason: RejectReason };

function fail(reason: RejectReason): ApplyResult {
  return { ok: false, reason };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Cards of one column, sorted by their order field. */
export function cardsInColumn(state: BoardState, columnId: string): Card[] {
  return state.cards
    .filter((c) => c.columnId === columnId)
    .sort((a, b) => a.order - b.order);
}

/** Columns sorted by their order field. */
export function sortedColumns(state: BoardState) {
  return [...state.columns].sort((a, b) => a.order - b.order);
}

function renumberColumnCards(state: BoardState, columnId: string): void {
  cardsInColumn(state, columnId).forEach((card, i) => {
    card.order = i;
  });
}

function renumberColumns(state: BoardState): void {
  sortedColumns(state).forEach((column, i) => {
    column.order = i;
  });
}

function validTitle(title: string): boolean {
  return title.trim().length > 0 && title.length <= LIMITS.titleLength;
}

export function applyOp(prev: BoardState, op: Op): ApplyResult {
  const state = structuredClone(prev);

  switch (op.type) {
    case 'createCard': {
      if (!validTitle(op.title)) return fail('invalid_op');
      if (op.description !== undefined && op.description.length > LIMITS.descriptionLength) {
        return fail('invalid_op');
      }
      if (!state.columns.some((c) => c.id === op.columnId)) return fail('column_not_found');
      if (state.cards.some((c) => c.id === op.cardId)) return fail('duplicate_id');
      if (state.cards.length >= LIMITS.cardsPerBoard) return fail('limit_exceeded');

      const siblings = cardsInColumn(state, op.columnId);
      const index = clamp(op.index ?? siblings.length, 0, siblings.length);
      state.cards.push({
        id: op.cardId,
        columnId: op.columnId,
        title: op.title,
        description: op.description ?? '',
        // Insert between neighbors; renumbering below makes it exact.
        order: index - 0.5,
      });
      renumberColumnCards(state, op.columnId);
      return { ok: true, state };
    }

    case 'moveCard': {
      const card = state.cards.find((c) => c.id === op.cardId);
      if (!card) return fail('card_not_found');
      if (!state.columns.some((c) => c.id === op.toColumnId)) return fail('column_not_found');

      const fromColumnId = card.columnId;
      card.columnId = op.toColumnId;

      // Remove-then-insert semantics: toIndex addresses the target column
      // as it looks without the moved card.
      const siblings = cardsInColumn(state, op.toColumnId).filter((c) => c.id !== card.id);
      const index = clamp(op.toIndex, 0, siblings.length);
      siblings.splice(index, 0, card);
      siblings.forEach((c, i) => {
        c.order = i;
      });
      if (fromColumnId !== op.toColumnId) renumberColumnCards(state, fromColumnId);
      return { ok: true, state };
    }

    case 'editCard': {
      const card = state.cards.find((c) => c.id === op.cardId);
      if (!card) return fail('card_not_found');
      if (op.title !== undefined) {
        if (!validTitle(op.title)) return fail('invalid_op');
        card.title = op.title;
      }
      if (op.description !== undefined) {
        if (op.description.length > LIMITS.descriptionLength) return fail('invalid_op');
        card.description = op.description;
      }
      return { ok: true, state };
    }

    case 'deleteCard': {
      const card = state.cards.find((c) => c.id === op.cardId);
      if (!card) return fail('card_not_found');
      state.cards = state.cards.filter((c) => c.id !== op.cardId);
      renumberColumnCards(state, card.columnId);
      return { ok: true, state };
    }

    case 'createColumn': {
      if (!validTitle(op.title)) return fail('invalid_op');
      if (state.columns.some((c) => c.id === op.columnId)) return fail('duplicate_id');
      if (state.columns.length >= LIMITS.columnsPerBoard) return fail('limit_exceeded');

      const index = clamp(op.index ?? state.columns.length, 0, state.columns.length);
      state.columns.push({ id: op.columnId, title: op.title, order: index - 0.5 });
      renumberColumns(state);
      return { ok: true, state };
    }

    case 'renameColumn': {
      const column = state.columns.find((c) => c.id === op.columnId);
      if (!column) return fail('column_not_found');
      if (!validTitle(op.title)) return fail('invalid_op');
      column.title = op.title;
      return { ok: true, state };
    }

    case 'deleteColumn': {
      const column = state.columns.find((c) => c.id === op.columnId);
      if (!column) return fail('column_not_found');
      state.columns = state.columns.filter((c) => c.id !== op.columnId);
      state.cards = state.cards.filter((c) => c.columnId !== op.columnId);
      renumberColumns(state);
      return { ok: true, state };
    }

    case 'reorderColumn': {
      const column = state.columns.find((c) => c.id === op.columnId);
      if (!column) return fail('column_not_found');

      const others = sortedColumns(state).filter((c) => c.id !== op.columnId);
      const index = clamp(op.toIndex, 0, others.length);
      others.splice(index, 0, column);
      others.forEach((c, i) => {
        c.order = i;
      });
      return { ok: true, state };
    }
  }
}
