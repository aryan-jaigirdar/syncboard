/**
 * Shared protocol and entity types for syncboard.
 *
 * Both the server and the web client import this file directly, so the wire
 * protocol and the board model live in exactly one place.
 */

export interface Column {
  id: string;
  title: string;
  /** Zero-based position of the column on the board. Always normalized to 0..n-1. */
  order: number;
}

export interface Card {
  id: string;
  columnId: string;
  title: string;
  description: string;
  /** Zero-based position of the card within its column. Always normalized to 0..n-1. */
  order: number;
}

export interface BoardState {
  id: string;
  /** Monotonically increasing version. Every applied op bumps it by exactly one. */
  version: number;
  columns: Column[];
  cards: Card[];
}

/**
 * Intents a client can propose. The server is authoritative: it validates,
 * applies, persists and rebroadcasts each op with the new board version.
 */
export type Op =
  | { type: 'createCard'; cardId: string; columnId: string; title: string; description?: string; index?: number }
  | { type: 'moveCard'; cardId: string; toColumnId: string; toIndex: number }
  | { type: 'editCard'; cardId: string; title?: string; description?: string }
  | { type: 'deleteCard'; cardId: string }
  | { type: 'duplicateCard'; cardId: string; newCardId: string }
  | { type: 'createColumn'; columnId: string; title: string; index?: number }
  | { type: 'renameColumn'; columnId: string; title: string }
  | { type: 'deleteColumn'; columnId: string }
  | { type: 'reorderColumn'; columnId: string; toIndex: number };

export type RejectReason =
  | 'card_not_found'
  | 'column_not_found'
  | 'duplicate_id'
  | 'invalid_op'
  | 'limit_exceeded';

/** An op the server accepted, stamped with the version it produced. */
export interface AppliedOp {
  version: number;
  op: Op;
  /** clientId of the connection that proposed the op. */
  actorId: string;
  /** Client-generated id used to match acks against optimistic pending ops. */
  opId: string;
}

export interface Peer {
  clientId: string;
  name: string;
  color: string;
}

export type ClientMessage =
  | { type: 'join'; boardId: string; clientId: string; name: string; sinceVersion?: number }
  | { type: 'op'; opId: string; baseVersion: number; op: Op }
  | { type: 'cursor'; x: number; y: number; visible: boolean }
  | { type: 'setName'; name: string };

export type ServerMessage =
  | { type: 'snapshot'; state: BoardState; peers: Peer[] }
  | { type: 'ops'; ops: AppliedOp[]; catchup?: boolean }
  | { type: 'reject'; opId: string; reason: RejectReason; version: number }
  | { type: 'presence'; peers: Peer[] }
  | { type: 'cursor'; clientId: string; x: number; y: number; visible: boolean }
  | { type: 'error'; code: 'board_not_found' | 'bad_request'; message: string };

export const LIMITS = {
  titleLength: 300,
  descriptionLength: 5000,
  nameLength: 40,
  cardsPerBoard: 2000,
  columnsPerBoard: 100,
} as const;

export const DEFAULT_COLUMN_TITLES = ['To do', 'In progress', 'Done'] as const;
