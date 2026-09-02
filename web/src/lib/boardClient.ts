/**
 * Client-side sync engine for one board.
 *
 * Holds the last confirmed server state plus a queue of optimistic pending
 * ops. The rendered view is confirmed state with pending ops replayed on top
 * using the exact same applyOp the server runs, so an accepted op looks
 * identical before and after its ack. Rejected or impossible pending ops are
 * dropped, which is the rollback.
 *
 * Reconnects join with the last confirmed version; the server replays missed
 * ops from its log or falls back to a full snapshot. Pending ops are resent
 * after every (re)join, minus any the server already applied.
 */

import type {
  AppliedOp,
  BoardState,
  Op,
  Peer,
  RejectReason,
  ServerMessage,
} from '../../../shared/types';
import { applyOp } from '../../../shared/ops';
import { genId } from '../../../shared/ids';
import { colorForId } from '../../../shared/color';
import { Connection, type ConnectionStatus } from './connection';
import { getClientId, getName, saveName } from './session';

export type BoardStatus = 'connecting' | 'online' | 'reconnecting' | 'not_found';

export interface Notice {
  id: number;
  text: string;
}

export interface BoardSnapshot {
  state: BoardState | null;
  status: BoardStatus;
  peers: Peer[];
  self: Peer;
  notices: Notice[];
}

export interface PeerCursor {
  clientId: string;
  name: string;
  color: string;
  x: number;
  y: number;
}

interface PendingOp {
  opId: string;
  op: Op;
}

const REJECT_TEXT: Record<RejectReason, string> = {
  card_not_found: 'That card no longer exists. Your change was rolled back.',
  column_not_found: 'That column no longer exists. Your change was rolled back.',
  duplicate_id: 'The change collided with an existing item and was rolled back.',
  invalid_op: 'The change was not valid and was rolled back.',
  limit_exceeded: 'The board limit was reached. Your change was rolled back.',
};

function wsUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/ws`;
}

type Listener = () => void;

export class BoardClient {
  readonly clientId = getClientId();

  private readonly conn: Connection;
  private confirmed: BoardState | null = null;
  private pending: PendingOp[] = [];
  private peers: Peer[] = [];
  private name = getName();
  private status: BoardStatus = 'connecting';
  private notices: Notice[] = [];
  private noticeSeq = 0;

  private readonly cursors = new Map<string, { x: number; y: number }>();

  private boardListeners = new Set<Listener>();
  private cursorListeners = new Set<Listener>();
  private boardSnapshot: BoardSnapshot;
  private cursorSnapshot: PeerCursor[] = [];

  constructor(private readonly boardId: string) {
    this.boardSnapshot = this.buildSnapshot();
    this.conn = new Connection(wsUrl(), {
      onOpen: () => this.join(),
      onMessage: (msg) => this.onMessage(msg),
      onStatus: (status) => this.onConnectionStatus(status),
    });
  }

  start(): void {
    this.conn.start();
  }

  dispose(): void {
    this.conn.stop();
    this.boardListeners.clear();
    this.cursorListeners.clear();
  }

  // --- outgoing ---------------------------------------------------------

  private join(): void {
    this.conn.send({
      type: 'join',
      boardId: this.boardId,
      clientId: this.clientId,
      name: this.name,
      ...(this.confirmed ? { sinceVersion: this.confirmed.version } : {}),
    });
  }

  /** Apply an intent optimistically and submit it to the server. */
  intent(op: Op): void {
    if (!this.confirmed) return;
    // Refuse intents that do not even apply to the current optimistic view;
    // the UI should never produce these, but it keeps pending ops meaningful.
    const check = applyOp(this.view(), op);
    if (!check.ok) return;

    const pendingOp: PendingOp = { opId: genId(12), op };
    this.pending.push(pendingOp);
    this.conn.send({
      type: 'op',
      opId: pendingOp.opId,
      baseVersion: this.confirmed.version,
      op,
    });
    this.emitBoard();
  }

  sendCursor(x: number, y: number, visible: boolean): void {
    if (this.status !== 'online') return;
    this.conn.send({ type: 'cursor', x: Math.max(0, x), y: Math.max(0, y), visible });
  }

  setName(rawName: string): void {
    const name = rawName.trim().slice(0, 40);
    if (name.length === 0 || name === this.name) return;
    this.name = name;
    saveName(name);
    this.conn.send({ type: 'setName', name });
    this.emitBoard();
  }

  dismissNotice(id: number): void {
    const before = this.notices.length;
    this.notices = this.notices.filter((n) => n.id !== id);
    if (this.notices.length !== before) this.emitBoard();
  }

  // --- incoming ---------------------------------------------------------

  private onConnectionStatus(status: ConnectionStatus): void {
    if (this.status === 'not_found') return;
    if (status === 'connecting') this.setStatus('connecting');
    else if (status === 'reconnecting') this.setStatus('reconnecting');
    // 'open' flips to online only once the join answer (snapshot or catchup)
    // arrives, so the UI does not flash an online badge on a dead board.
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'snapshot': {
        this.confirmed = msg.state;
        this.peers = msg.peers;
        this.setStatus('online');
        this.resendPending();
        this.emitBoard();
        break;
      }
      case 'ops': {
        for (const applied of msg.ops) {
          this.applyConfirmed(applied);
        }
        if (msg.catchup) {
          this.setStatus('online');
          this.resendPending();
        }
        this.emitBoard();
        break;
      }
      case 'reject': {
        this.pending = this.pending.filter((p) => p.opId !== msg.opId);
        this.pushNotice(REJECT_TEXT[msg.reason]);
        this.emitBoard();
        break;
      }
      case 'presence': {
        this.peers = msg.peers;
        for (const id of [...this.cursors.keys()]) {
          if (!msg.peers.some((p) => p.clientId === id)) this.cursors.delete(id);
        }
        this.emitBoard();
        this.emitCursors();
        break;
      }
      case 'cursor': {
        if (msg.clientId === this.clientId) break;
        if (msg.visible) this.cursors.set(msg.clientId, { x: msg.x, y: msg.y });
        else this.cursors.delete(msg.clientId);
        this.emitCursors();
        break;
      }
      case 'error': {
        if (msg.code === 'board_not_found') {
          this.setStatus('not_found');
          this.conn.stop();
          this.emitBoard();
        }
        break;
      }
    }
  }

  private applyConfirmed(applied: AppliedOp): void {
    if (!this.confirmed) return;
    // The server replays its history in order; version gaps mean this client
    // missed a message and must resync from a fresh snapshot.
    if (applied.version !== this.confirmed.version + 1) {
      if (applied.version <= this.confirmed.version) return; // stale duplicate
      this.requestResync();
      return;
    }
    const result = applyOp(this.confirmed, applied.op);
    if (!result.ok) {
      this.requestResync();
      return;
    }
    result.state.version = applied.version;
    this.confirmed = result.state;
    if (applied.actorId === this.clientId) {
      this.pending = this.pending.filter((p) => p.opId !== applied.opId);
    }
  }

  private requestResync(): void {
    // A join on an already-joined socket makes the server send a snapshot.
    this.conn.send({
      type: 'join',
      boardId: this.boardId,
      clientId: this.clientId,
      name: this.name,
    });
  }

  private resendPending(): void {
    if (!this.confirmed) return;
    for (const p of this.pending) {
      this.conn.send({
        type: 'op',
        opId: p.opId,
        baseVersion: this.confirmed.version,
        op: p.op,
      });
    }
  }

  private pushNotice(text: string): void {
    this.noticeSeq += 1;
    this.notices = [...this.notices, { id: this.noticeSeq, text }].slice(-3);
  }

  private setStatus(status: BoardStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.emitBoard();
    }
  }

  // --- derived state ----------------------------------------------------

  /** Confirmed state plus pending ops; pending ops that no longer apply are skipped. */
  private view(): BoardState {
    if (!this.confirmed) throw new Error('view() requires a confirmed state');
    let state = this.confirmed;
    for (const p of this.pending) {
      const result = applyOp(state, p.op);
      if (result.ok) state = result.state;
    }
    return state;
  }

  private buildSnapshot(): BoardSnapshot {
    return {
      state: this.confirmed ? this.view() : null,
      status: this.status,
      peers: this.peers,
      self: { clientId: this.clientId, name: this.name, color: colorForId(this.clientId) },
      notices: this.notices,
    };
  }

  // --- subscriptions (useSyncExternalStore contract) ---------------------

  subscribe = (listener: Listener): (() => void) => {
    this.boardListeners.add(listener);
    return () => this.boardListeners.delete(listener);
  };

  getSnapshot = (): BoardSnapshot => this.boardSnapshot;

  subscribeCursors = (listener: Listener): (() => void) => {
    this.cursorListeners.add(listener);
    return () => this.cursorListeners.delete(listener);
  };

  getCursors = (): PeerCursor[] => this.cursorSnapshot;

  private emitBoard(): void {
    this.boardSnapshot = this.buildSnapshot();
    for (const listener of this.boardListeners) listener();
  }

  private emitCursors(): void {
    this.cursorSnapshot = [...this.cursors.entries()].map(([clientId, pos]) => {
      const peer = this.peers.find((p) => p.clientId === clientId);
      return {
        clientId,
        name: peer?.name ?? 'Guest',
        color: peer?.color ?? colorForId(clientId),
        x: pos.x,
        y: pos.y,
      };
    });
    for (const listener of this.cursorListeners) listener();
  }
}
