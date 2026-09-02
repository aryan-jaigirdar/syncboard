/**
 * A room is one live board: the authoritative in-memory state, an in-memory
 * op log for cheap reconnects, and the set of connected clients.
 */

import type { WebSocket } from 'ws';
import type {
  AppliedOp,
  BoardState,
  ClientMessage,
  Peer,
  ServerMessage,
} from '../../shared/types.js';
import { applyOp } from '../../shared/ops.js';
import { colorForId } from '../../shared/color.js';
import type { BoardStore } from './store.js';

/** How many applied ops each room keeps for replay on reconnect. */
export const OP_LOG_LIMIT = 500;

/** Minimum interval between relayed cursor updates per client, in ms. */
const CURSOR_MIN_INTERVAL_MS = 40;

/** How long an empty room stays in memory before being evicted, in ms. */
const ROOM_IDLE_TTL_MS = 5 * 60 * 1000;

interface RoomClient {
  ws: WebSocket;
  clientId: string;
  name: string;
  color: string;
  lastCursorAt: number;
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export class Room {
  private state: BoardState;
  private readonly log: AppliedOp[] = [];
  private readonly clients = new Map<WebSocket, RoomClient>();

  constructor(
    private readonly store: BoardStore,
    state: BoardState,
  ) {
    this.state = state;
  }

  get boardId(): string {
    return this.state.id;
  }

  get version(): number {
    return this.state.version;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Test and diagnostics helper; room state must only change via handleOp. */
  getState(): BoardState {
    return this.state;
  }

  peers(): Peer[] {
    return [...this.clients.values()].map((c) => ({
      clientId: c.clientId,
      name: c.name,
      color: c.color,
    }));
  }

  addClient(ws: WebSocket, join: Extract<ClientMessage, { type: 'join' }>): void {
    const existing = this.clients.get(ws);
    if (existing) {
      // A joined socket asking to join again is a resync request.
      send(ws, { type: 'snapshot', state: this.state, peers: this.peers() });
      return;
    }

    this.clients.set(ws, {
      ws,
      clientId: join.clientId,
      name: join.name,
      color: colorForId(join.clientId),
      lastCursorAt: 0,
    });

    const since = join.sinceVersion;
    if (since !== undefined && this.canReplayFrom(since)) {
      const ops = this.log.filter((entry) => entry.version > since);
      send(ws, { type: 'ops', ops, catchup: true });
    } else {
      send(ws, { type: 'snapshot', state: this.state, peers: this.peers() });
    }
    this.broadcastPresence();
  }

  private canReplayFrom(since: number): boolean {
    // A client claiming a version ahead of the server is out of sync in a way
    // replay cannot fix, so it gets a snapshot.
    if (since > this.state.version) return false;
    // Already up to date; an empty catchup confirms the join.
    if (since === this.state.version) return true;
    // Replay works only if the log still holds every op after `since`.
    const oldest = this.log[0];
    return oldest !== undefined && oldest.version <= since + 1;
  }

  handleOp(ws: WebSocket, msg: Extract<ClientMessage, { type: 'op' }>): void {
    const client = this.clients.get(ws);
    if (!client) return;

    const result = applyOp(this.state, msg.op);
    if (!result.ok) {
      send(ws, {
        type: 'reject',
        opId: msg.opId,
        reason: result.reason,
        version: this.state.version,
      });
      return;
    }

    const prev = this.state;
    const next = result.state;
    next.version = prev.version + 1;
    this.store.persist(prev, next, msg.op);
    this.state = next;

    const applied: AppliedOp = {
      version: next.version,
      op: msg.op,
      actorId: client.clientId,
      opId: msg.opId,
    };
    this.log.push(applied);
    if (this.log.length > OP_LOG_LIMIT) this.log.shift();

    this.broadcast({ type: 'ops', ops: [applied] });
  }

  handleCursor(ws: WebSocket, msg: Extract<ClientMessage, { type: 'cursor' }>): void {
    const client = this.clients.get(ws);
    if (!client) return;

    const now = Date.now();
    if (msg.visible && now - client.lastCursorAt < CURSOR_MIN_INTERVAL_MS) return;
    client.lastCursorAt = now;

    const relay: ServerMessage = {
      type: 'cursor',
      clientId: client.clientId,
      x: msg.x,
      y: msg.y,
      visible: msg.visible,
    };
    for (const other of this.clients.values()) {
      if (other.ws !== ws) send(other.ws, relay);
    }
  }

  handleSetName(ws: WebSocket, name: string): void {
    const client = this.clients.get(ws);
    if (!client) return;
    client.name = name;
    this.broadcastPresence();
  }

  removeClient(ws: WebSocket): number {
    if (this.clients.delete(ws)) {
      this.broadcastPresence();
    }
    return this.clients.size;
  }

  private broadcastPresence(): void {
    this.broadcast({ type: 'presence', peers: this.peers() });
  }

  private broadcast(msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const client of this.clients.values()) {
      if (client.ws.readyState === client.ws.OPEN) {
        client.ws.send(payload);
      }
    }
  }
}

/**
 * Loads rooms on demand and evicts them a few minutes after the last client
 * leaves. State is persisted on every op, so eviction never loses data, it
 * only drops the in-memory op log (reconnects then fall back to a snapshot).
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly idleTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly store: BoardStore) {}

  get(boardId: string): Room | null {
    const existing = this.rooms.get(boardId);
    if (existing) {
      this.cancelEviction(boardId);
      return existing;
    }
    const state = this.store.loadBoard(boardId);
    if (!state) return null;
    const room = new Room(this.store, state);
    this.rooms.set(boardId, room);
    return room;
  }

  clientLeft(room: Room, ws: WebSocket): void {
    const remaining = room.removeClient(ws);
    if (remaining === 0) {
      this.scheduleEviction(room.boardId);
    }
  }

  private scheduleEviction(boardId: string): void {
    this.cancelEviction(boardId);
    const timer = setTimeout(() => {
      const room = this.rooms.get(boardId);
      if (room && room.clientCount === 0) {
        this.rooms.delete(boardId);
      }
      this.idleTimers.delete(boardId);
    }, ROOM_IDLE_TTL_MS);
    timer.unref?.();
    this.idleTimers.set(boardId, timer);
  }

  private cancelEviction(boardId: string): void {
    const timer = this.idleTimers.get(boardId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(boardId);
    }
  }

  dispose(): void {
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
    this.idleTimers.clear();
    this.rooms.clear();
  }
}
