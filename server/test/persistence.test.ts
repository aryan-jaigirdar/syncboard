import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BoardState, Op } from '../../shared/types.js';
import { DEFAULT_COLUMN_TITLES } from '../../shared/types.js';
import { applyOp } from '../../shared/ops.js';
import { BoardStore } from '../src/store.js';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syncboard-test-'));
  dbPath = path.join(dir, 'test.db');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Apply an op the way a room does: validate, bump version, persist. */
function applyAndPersist(store: BoardStore, state: BoardState, op: Op): BoardState {
  const result = applyOp(state, op);
  if (!result.ok) throw new Error(`expected op to apply, got ${result.reason}`);
  result.state.version = state.version + 1;
  store.persist(state, result.state, op);
  return result.state;
}

describe('BoardStore', () => {
  it('creates a board with the default columns at version 0', () => {
    const store = new BoardStore(dbPath);
    const state = store.createBoard();
    expect(state.version).toBe(0);
    expect(state.columns.map((c) => c.title)).toEqual([...DEFAULT_COLUMN_TITLES]);
    expect(state.columns.map((c) => c.order)).toEqual([0, 1, 2]);
    expect(state.cards).toEqual([]);
    expect(store.hasBoard(state.id)).toBe(true);
    expect(store.hasBoard('missing1')).toBe(false);
    store.close();
  });

  it('roundtrips a full editing session through a reopen', () => {
    let store = new BoardStore(dbPath);
    let state = store.createBoard();
    const [todo, doing, done] = state.columns;
    if (!todo || !doing || !done) throw new Error('expected default columns');

    const script: Op[] = [
      { type: 'createCard', cardId: 'cardAAA1', columnId: todo.id, title: 'Write docs' },
      {
        type: 'createCard',
        cardId: 'cardAAA2',
        columnId: todo.id,
        title: 'Ship it',
        description: 'after review',
      },
      { type: 'createCard', cardId: 'cardAAA3', columnId: doing.id, title: 'Fix flaky test' },
      { type: 'moveCard', cardId: 'cardAAA1', toColumnId: doing.id, toIndex: 0 },
      { type: 'editCard', cardId: 'cardAAA2', title: 'Ship it soon', description: 'today' },
      { type: 'createColumn', columnId: 'colExtra1', title: 'Blocked', index: 1 },
      { type: 'moveCard', cardId: 'cardAAA3', toColumnId: 'colExtra1', toIndex: 0 },
      { type: 'renameColumn', columnId: 'colExtra1', title: 'Waiting' },
      { type: 'reorderColumn', columnId: 'colExtra1', toIndex: 3 },
      { type: 'deleteCard', cardId: 'cardAAA2' },
    ];
    for (const op of script) {
      state = applyAndPersist(store, state, op);
    }
    expect(state.version).toBe(script.length);
    store.close();

    store = new BoardStore(dbPath);
    const reloaded = store.loadBoard(state.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded).toEqual(state);
    store.close();
  });

  it('persists a column deletion including its cards', () => {
    let store = new BoardStore(dbPath);
    let state = store.createBoard();
    const todo = state.columns[0];
    if (!todo) throw new Error('expected default columns');

    state = applyAndPersist(store, state, {
      type: 'createCard',
      cardId: 'cardDDD1',
      columnId: todo.id,
      title: 'Doomed',
    });
    state = applyAndPersist(store, state, { type: 'deleteColumn', columnId: todo.id });
    store.close();

    store = new BoardStore(dbPath);
    const reloaded = store.loadBoard(state.id);
    expect(reloaded).toEqual(state);
    expect(reloaded?.cards).toEqual([]);
    expect(reloaded?.columns).toHaveLength(2);
    store.close();
  });

  it('persists the version across restarts', () => {
    let store = new BoardStore(dbPath);
    let state = store.createBoard();
    const todo = state.columns[0];
    if (!todo) throw new Error('expected default columns');
    for (let i = 0; i < 5; i++) {
      state = applyAndPersist(store, state, {
        type: 'createCard',
        cardId: `cardVVV${i}`,
        columnId: todo.id,
        title: `Card ${i}`,
      });
    }
    store.close();

    store = new BoardStore(dbPath);
    expect(store.loadBoard(state.id)?.version).toBe(5);
    store.close();
  });

  it('keeps boards isolated from each other', () => {
    const store = new BoardStore(dbPath);
    const first = store.createBoard();
    const second = store.createBoard();
    const firstTodo = first.columns[0];
    if (!firstTodo) throw new Error('expected default columns');

    applyAndPersist(store, first, {
      type: 'createCard',
      cardId: 'cardIso1',
      columnId: firstTodo.id,
      title: 'Only on first board',
    });

    expect(store.loadBoard(second.id)?.cards).toEqual([]);
    expect(store.loadBoard(first.id)?.cards).toHaveLength(1);
    store.close();
  });

  it('returns null for an unknown board', () => {
    const store = new BoardStore(dbPath);
    expect(store.loadBoard('unknown9')).toBeNull();
    store.close();
  });
});
