/**
 * SQLite persistence for boards.
 *
 * The room layer keeps the authoritative state in memory and calls persist()
 * after every accepted op. Writes are targeted per op type and wrapped in a
 * transaction, so the database always reflects a whole version, never a
 * partial one.
 */

import Database from 'better-sqlite3';
import type { BoardState, Op } from '../../shared/types.js';
import { DEFAULT_COLUMN_TITLES } from '../../shared/types.js';
import { genBoardId, genId } from '../../shared/ids.js';
import { cardsInColumn, sortedColumns } from '../../shared/ops.js';

interface BoardRow {
  id: string;
  version: number;
}

interface ColumnRow {
  id: string;
  title: string;
  ord: number;
}

interface CardRow {
  id: string;
  column_id: string;
  title: string;
  description: string;
  ord: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS columns (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  ord INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_columns_board ON columns(board_id);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  ord INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cards_board ON cards(board_id);
CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(column_id);
`;

export class BoardStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  createBoard(): BoardState {
    const id = genBoardId();
    const now = Date.now();
    const insertBoard = this.db.prepare(
      'INSERT INTO boards (id, version, created_at) VALUES (?, 0, ?)',
    );
    const insertColumn = this.db.prepare(
      'INSERT INTO columns (id, board_id, title, ord) VALUES (?, ?, ?, ?)',
    );
    this.db.transaction(() => {
      insertBoard.run(id, now);
      DEFAULT_COLUMN_TITLES.forEach((title, i) => {
        insertColumn.run(genId(), id, title, i);
      });
    })();
    const state = this.loadBoard(id);
    if (!state) throw new Error(`board ${id} vanished right after creation`);
    return state;
  }

  hasBoard(id: string): boolean {
    return this.db.prepare('SELECT 1 FROM boards WHERE id = ?').get(id) !== undefined;
  }

  loadBoard(id: string): BoardState | null {
    const board = this.db
      .prepare('SELECT id, version FROM boards WHERE id = ?')
      .get(id) as BoardRow | undefined;
    if (!board) return null;

    const columns = this.db
      .prepare('SELECT id, title, ord FROM columns WHERE board_id = ? ORDER BY ord')
      .all(id) as ColumnRow[];
    const cards = this.db
      .prepare(
        'SELECT id, column_id, title, description, ord FROM cards WHERE board_id = ? ORDER BY ord',
      )
      .all(id) as CardRow[];

    return {
      id: board.id,
      version: board.version,
      columns: columns.map((c) => ({ id: c.id, title: c.title, order: c.ord })),
      cards: cards.map((c) => ({
        id: c.id,
        columnId: c.column_id,
        title: c.title,
        description: c.description,
        order: c.ord,
      })),
    };
  }

  /**
   * Persist one accepted op. prev is the state the op was applied to, next is
   * the result (already carrying the bumped version).
   */
  persist(prev: BoardState, next: BoardState, op: Op): void {
    const boardId = next.id;
    this.db.transaction(() => {
      switch (op.type) {
        case 'createCard': {
          const card = next.cards.find((c) => c.id === op.cardId);
          if (!card) throw new Error('createCard persisted without a card');
          this.db
            .prepare(
              'INSERT INTO cards (id, board_id, column_id, title, description, ord) VALUES (?, ?, ?, ?, ?, ?)',
            )
            .run(card.id, boardId, card.columnId, card.title, card.description, card.order);
          this.syncCardPositions(next, op.columnId);
          break;
        }
        case 'moveCard': {
          const before = prev.cards.find((c) => c.id === op.cardId);
          if (!before) throw new Error('moveCard persisted without a card');
          this.syncCardPositions(next, op.toColumnId);
          if (before.columnId !== op.toColumnId) {
            this.syncCardPositions(next, before.columnId);
          }
          break;
        }
        case 'editCard': {
          const card = next.cards.find((c) => c.id === op.cardId);
          if (!card) throw new Error('editCard persisted without a card');
          this.db
            .prepare('UPDATE cards SET title = ?, description = ? WHERE id = ?')
            .run(card.title, card.description, card.id);
          break;
        }
        case 'deleteCard': {
          const before = prev.cards.find((c) => c.id === op.cardId);
          if (!before) throw new Error('deleteCard persisted without a card');
          this.db.prepare('DELETE FROM cards WHERE id = ?').run(op.cardId);
          this.syncCardPositions(next, before.columnId);
          break;
        }
        case 'duplicateCard': {
          const card = next.cards.find((c) => c.id === op.newCardId);
          if (!card) throw new Error('duplicateCard persisted without a card');
          this.db
            .prepare(
              'INSERT INTO cards (id, board_id, column_id, title, description, ord) VALUES (?, ?, ?, ?, ?, ?)',
            )
            .run(card.id, boardId, card.columnId, card.title, card.description, card.order);
          this.syncCardPositions(next, card.columnId);
          break;
        }
        case 'createColumn': {
          const column = next.columns.find((c) => c.id === op.columnId);
          if (!column) throw new Error('createColumn persisted without a column');
          this.db
            .prepare('INSERT INTO columns (id, board_id, title, ord) VALUES (?, ?, ?, ?)')
            .run(column.id, boardId, column.title, column.order);
          this.syncColumnPositions(next);
          break;
        }
        case 'renameColumn': {
          const column = next.columns.find((c) => c.id === op.columnId);
          if (!column) throw new Error('renameColumn persisted without a column');
          this.db
            .prepare('UPDATE columns SET title = ? WHERE id = ?')
            .run(column.title, column.id);
          break;
        }
        case 'deleteColumn': {
          // ON DELETE CASCADE removes the column's cards.
          this.db.prepare('DELETE FROM columns WHERE id = ?').run(op.columnId);
          this.syncColumnPositions(next);
          break;
        }
        case 'reorderColumn': {
          this.syncColumnPositions(next);
          break;
        }
      }
      this.db.prepare('UPDATE boards SET version = ? WHERE id = ?').run(next.version, boardId);
    })();
  }

  private syncCardPositions(state: BoardState, columnId: string): void {
    const update = this.db.prepare('UPDATE cards SET column_id = ?, ord = ? WHERE id = ?');
    for (const card of cardsInColumn(state, columnId)) {
      update.run(card.columnId, card.order, card.id);
    }
  }

  private syncColumnPositions(state: BoardState): void {
    const update = this.db.prepare('UPDATE columns SET ord = ? WHERE id = ?');
    for (const column of sortedColumns(state)) {
      update.run(column.order, column.id);
    }
  }

  close(): void {
    this.db.close();
  }
}
