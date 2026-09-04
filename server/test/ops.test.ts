import { describe, expect, it } from 'vitest';
import type { BoardState, CardLabel, Op } from '../../shared/types.js';
import { applyOp, cardsInColumn, sortedColumns } from '../../shared/ops.js';

function board(): BoardState {
  return {
    id: 'testboard',
    version: 0,
    columns: [
      { id: 'colA', title: 'To do', order: 0 },
      { id: 'colB', title: 'In progress', order: 1 },
      { id: 'colC', title: 'Done', order: 2 },
    ],
    cards: [
      { id: 'cardA1', columnId: 'colA', title: 'First', description: '', order: 0 },
      { id: 'cardA2', columnId: 'colA', title: 'Second', description: '', order: 1 },
      { id: 'cardA3', columnId: 'colA', title: 'Third', description: '', order: 2 },
      { id: 'cardB1', columnId: 'colB', title: 'Started', description: 'wip', order: 0 },
    ],
  };
}

function mustApply(state: BoardState, op: Op): BoardState {
  const result = applyOp(state, op);
  if (!result.ok) throw new Error(`expected op to apply, got ${result.reason}`);
  return result.state;
}

function idsIn(state: BoardState, columnId: string): string[] {
  return cardsInColumn(state, columnId).map((c) => c.id);
}

describe('applyOp immutability', () => {
  it('never mutates the input state', () => {
    const before = board();
    const frozen = JSON.stringify(before);
    mustApply(before, { type: 'moveCard', cardId: 'cardA1', toColumnId: 'colB', toIndex: 0 });
    mustApply(before, { type: 'deleteColumn', columnId: 'colA' });
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it('does not touch the version field', () => {
    const next = mustApply(board(), { type: 'deleteCard', cardId: 'cardA1' });
    expect(next.version).toBe(0);
  });
});

describe('createCard', () => {
  it('appends to the end of the column by default', () => {
    const next = mustApply(board(), {
      type: 'createCard',
      cardId: 'cardNew',
      columnId: 'colA',
      title: 'Fourth',
    });
    expect(idsIn(next, 'colA')).toEqual(['cardA1', 'cardA2', 'cardA3', 'cardNew']);
    const created = next.cards.find((c) => c.id === 'cardNew');
    expect(created?.description).toBe('');
    expect(created?.order).toBe(3);
  });

  it('inserts at a given index and shifts later cards', () => {
    const next = mustApply(board(), {
      type: 'createCard',
      cardId: 'cardNew',
      columnId: 'colA',
      title: 'Between',
      index: 1,
    });
    expect(idsIn(next, 'colA')).toEqual(['cardA1', 'cardNew', 'cardA2', 'cardA3']);
    expect(cardsInColumn(next, 'colA').map((c) => c.order)).toEqual([0, 1, 2, 3]);
  });

  it('clamps an out-of-range index to the end', () => {
    const next = mustApply(board(), {
      type: 'createCard',
      cardId: 'cardNew',
      columnId: 'colB',
      title: 'Way out',
      index: 999,
    });
    expect(idsIn(next, 'colB')).toEqual(['cardB1', 'cardNew']);
  });

  it('rejects a missing column', () => {
    const result = applyOp(board(), {
      type: 'createCard',
      cardId: 'cardNew',
      columnId: 'ghost',
      title: 'Nope',
    });
    expect(result).toEqual({ ok: false, reason: 'column_not_found' });
  });

  it('rejects a duplicate card id', () => {
    const result = applyOp(board(), {
      type: 'createCard',
      cardId: 'cardA1',
      columnId: 'colA',
      title: 'Clone',
    });
    expect(result).toEqual({ ok: false, reason: 'duplicate_id' });
  });

  it('rejects a blank title', () => {
    const result = applyOp(board(), {
      type: 'createCard',
      cardId: 'cardNew',
      columnId: 'colA',
      title: '   ',
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_op' });
  });
});

describe('moveCard reorder semantics', () => {
  it('moves forward within a column using remove-then-insert indexing', () => {
    const next = mustApply(board(), {
      type: 'moveCard',
      cardId: 'cardA1',
      toColumnId: 'colA',
      toIndex: 2,
    });
    expect(idsIn(next, 'colA')).toEqual(['cardA2', 'cardA3', 'cardA1']);
  });

  it('moves backward within a column', () => {
    const next = mustApply(board(), {
      type: 'moveCard',
      cardId: 'cardA3',
      toColumnId: 'colA',
      toIndex: 0,
    });
    expect(idsIn(next, 'colA')).toEqual(['cardA3', 'cardA1', 'cardA2']);
  });

  it('is a no-op when the target position equals the current one', () => {
    const next = mustApply(board(), {
      type: 'moveCard',
      cardId: 'cardA2',
      toColumnId: 'colA',
      toIndex: 1,
    });
    expect(idsIn(next, 'colA')).toEqual(['cardA1', 'cardA2', 'cardA3']);
  });

  it('moves across columns and renumbers both', () => {
    const next = mustApply(board(), {
      type: 'moveCard',
      cardId: 'cardA2',
      toColumnId: 'colB',
      toIndex: 0,
    });
    expect(idsIn(next, 'colA')).toEqual(['cardA1', 'cardA3']);
    expect(idsIn(next, 'colB')).toEqual(['cardA2', 'cardB1']);
    expect(cardsInColumn(next, 'colA').map((c) => c.order)).toEqual([0, 1]);
    expect(cardsInColumn(next, 'colB').map((c) => c.order)).toEqual([0, 1]);
  });

  it('clamps the index into an empty column', () => {
    const next = mustApply(board(), {
      type: 'moveCard',
      cardId: 'cardA1',
      toColumnId: 'colC',
      toIndex: 5,
    });
    expect(idsIn(next, 'colC')).toEqual(['cardA1']);
  });

  it('rejects moving a deleted card gracefully', () => {
    const withoutCard = mustApply(board(), { type: 'deleteCard', cardId: 'cardA1' });
    const result = applyOp(withoutCard, {
      type: 'moveCard',
      cardId: 'cardA1',
      toColumnId: 'colB',
      toIndex: 0,
    });
    expect(result).toEqual({ ok: false, reason: 'card_not_found' });
  });

  it('rejects moving into a deleted column gracefully', () => {
    const withoutColumn = mustApply(board(), { type: 'deleteColumn', columnId: 'colB' });
    const result = applyOp(withoutColumn, {
      type: 'moveCard',
      cardId: 'cardA1',
      toColumnId: 'colB',
      toIndex: 0,
    });
    expect(result).toEqual({ ok: false, reason: 'column_not_found' });
  });
});

describe('editCard', () => {
  it('updates only the provided fields', () => {
    const next = mustApply(board(), {
      type: 'editCard',
      cardId: 'cardB1',
      title: 'Renamed',
    });
    const card = next.cards.find((c) => c.id === 'cardB1');
    expect(card?.title).toBe('Renamed');
    expect(card?.description).toBe('wip');
  });

  it('can clear a description', () => {
    const next = mustApply(board(), { type: 'editCard', cardId: 'cardB1', description: '' });
    expect(next.cards.find((c) => c.id === 'cardB1')?.description).toBe('');
  });

  it('rejects an edit of a deleted card', () => {
    const withoutCard = mustApply(board(), { type: 'deleteCard', cardId: 'cardB1' });
    const result = applyOp(withoutCard, { type: 'editCard', cardId: 'cardB1', title: 'Ghost' });
    expect(result).toEqual({ ok: false, reason: 'card_not_found' });
  });

  it('rejects a blank title', () => {
    const result = applyOp(board(), { type: 'editCard', cardId: 'cardB1', title: '' });
    expect(result).toEqual({ ok: false, reason: 'invalid_op' });
  });
});

describe('deleteCard', () => {
  it('removes the card and renumbers the column', () => {
    const next = mustApply(board(), { type: 'deleteCard', cardId: 'cardA2' });
    expect(idsIn(next, 'colA')).toEqual(['cardA1', 'cardA3']);
    expect(cardsInColumn(next, 'colA').map((c) => c.order)).toEqual([0, 1]);
  });

  it('rejects deleting twice', () => {
    const next = mustApply(board(), { type: 'deleteCard', cardId: 'cardA2' });
    const result = applyOp(next, { type: 'deleteCard', cardId: 'cardA2' });
    expect(result).toEqual({ ok: false, reason: 'card_not_found' });
  });
});

describe('duplicateCard', () => {
  it('copies the title and description of the source card', () => {
    const next = mustApply(board(), {
      type: 'duplicateCard',
      cardId: 'cardB1',
      newCardId: 'cardB1copy',
    });
    const copy = next.cards.find((c) => c.id === 'cardB1copy');
    expect(copy?.title).toBe('Started');
    expect(copy?.description).toBe('wip');
    expect(copy?.columnId).toBe('colB');
  });

  it('places the copy directly below the original and renumbers the column', () => {
    const next = mustApply(board(), {
      type: 'duplicateCard',
      cardId: 'cardA2',
      newCardId: 'cardA2copy',
    });
    expect(idsIn(next, 'colA')).toEqual(['cardA1', 'cardA2', 'cardA2copy', 'cardA3']);
    expect(cardsInColumn(next, 'colA').map((c) => c.order)).toEqual([0, 1, 2, 3]);
  });

  it('duplicates the last card to the end of the column', () => {
    const next = mustApply(board(), {
      type: 'duplicateCard',
      cardId: 'cardA3',
      newCardId: 'cardA3copy',
    });
    expect(idsIn(next, 'colA')).toEqual(['cardA1', 'cardA2', 'cardA3', 'cardA3copy']);
  });

  it('rejects duplicating a missing card gracefully', () => {
    const withoutCard = mustApply(board(), { type: 'deleteCard', cardId: 'cardA1' });
    const result = applyOp(withoutCard, {
      type: 'duplicateCard',
      cardId: 'cardA1',
      newCardId: 'cardA1copy',
    });
    expect(result).toEqual({ ok: false, reason: 'card_not_found' });
  });

  it('rejects a copy id that already exists', () => {
    const result = applyOp(board(), {
      type: 'duplicateCard',
      cardId: 'cardA1',
      newCardId: 'cardA2',
    });
    expect(result).toEqual({ ok: false, reason: 'duplicate_id' });
  });
});

describe('setCardLabel', () => {
  it('sets a card label from the palette', () => {
    const next = mustApply(board(), { type: 'setCardLabel', cardId: 'cardA1', label: 'green' });
    expect(next.cards.find((c) => c.id === 'cardA1')?.label).toBe('green');
  });

  it('leaves other card fields untouched', () => {
    const next = mustApply(board(), { type: 'setCardLabel', cardId: 'cardB1', label: 'blue' });
    const card = next.cards.find((c) => c.id === 'cardB1');
    expect(card?.title).toBe('Started');
    expect(card?.description).toBe('wip');
    expect(card?.order).toBe(0);
  });

  it('clears the label when set to none', () => {
    const labeled = mustApply(board(), { type: 'setCardLabel', cardId: 'cardA1', label: 'red' });
    const cleared = mustApply(labeled, { type: 'setCardLabel', cardId: 'cardA1', label: 'none' });
    expect(cleared.cards.find((c) => c.id === 'cardA1')?.label).toBeUndefined();
  });

  it('rejects an unknown label value', () => {
    const result = applyOp(board(), {
      type: 'setCardLabel',
      cardId: 'cardA1',
      label: 'chartreuse' as CardLabel,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_op' });
  });

  it('rejects setting a label on a missing card', () => {
    const withoutCard = mustApply(board(), { type: 'deleteCard', cardId: 'cardA1' });
    const result = applyOp(withoutCard, {
      type: 'setCardLabel',
      cardId: 'cardA1',
      label: 'blue',
    });
    expect(result).toEqual({ ok: false, reason: 'card_not_found' });
  });
});

describe('column ops', () => {
  it('creates a column at the end by default', () => {
    const next = mustApply(board(), { type: 'createColumn', columnId: 'colD', title: 'Review' });
    expect(sortedColumns(next).map((c) => c.id)).toEqual(['colA', 'colB', 'colC', 'colD']);
  });

  it('creates a column at an index', () => {
    const next = mustApply(board(), {
      type: 'createColumn',
      columnId: 'colD',
      title: 'Blocked',
      index: 1,
    });
    expect(sortedColumns(next).map((c) => c.id)).toEqual(['colA', 'colD', 'colB', 'colC']);
    expect(sortedColumns(next).map((c) => c.order)).toEqual([0, 1, 2, 3]);
  });

  it('rejects a duplicate column id', () => {
    const result = applyOp(board(), { type: 'createColumn', columnId: 'colA', title: 'Copy' });
    expect(result).toEqual({ ok: false, reason: 'duplicate_id' });
  });

  it('renames a column', () => {
    const next = mustApply(board(), { type: 'renameColumn', columnId: 'colA', title: 'Backlog' });
    expect(next.columns.find((c) => c.id === 'colA')?.title).toBe('Backlog');
  });

  it('rejects renaming a missing column', () => {
    const result = applyOp(board(), { type: 'renameColumn', columnId: 'ghost', title: 'X' });
    expect(result).toEqual({ ok: false, reason: 'column_not_found' });
  });

  it('deletes a column together with its cards', () => {
    const next = mustApply(board(), { type: 'deleteColumn', columnId: 'colA' });
    expect(next.columns.map((c) => c.id)).toEqual(['colB', 'colC']);
    expect(next.cards.map((c) => c.id)).toEqual(['cardB1']);
    expect(sortedColumns(next).map((c) => c.order)).toEqual([0, 1]);
  });

  it('reorders columns with remove-then-insert indexing', () => {
    const next = mustApply(board(), { type: 'reorderColumn', columnId: 'colA', toIndex: 2 });
    expect(sortedColumns(next).map((c) => c.id)).toEqual(['colB', 'colC', 'colA']);
    const back = mustApply(next, { type: 'reorderColumn', columnId: 'colA', toIndex: 0 });
    expect(sortedColumns(back).map((c) => c.id)).toEqual(['colA', 'colB', 'colC']);
  });

  it('clamps a column reorder index', () => {
    const next = mustApply(board(), { type: 'reorderColumn', columnId: 'colA', toIndex: 99 });
    expect(sortedColumns(next).map((c) => c.id)).toEqual(['colB', 'colC', 'colA']);
  });

  it('rejects ops against a deleted column', () => {
    const next = mustApply(board(), { type: 'deleteColumn', columnId: 'colB' });
    expect(applyOp(next, { type: 'deleteColumn', columnId: 'colB' })).toEqual({
      ok: false,
      reason: 'column_not_found',
    });
    expect(applyOp(next, { type: 'reorderColumn', columnId: 'colB', toIndex: 0 })).toEqual({
      ok: false,
      reason: 'column_not_found',
    });
  });
});
