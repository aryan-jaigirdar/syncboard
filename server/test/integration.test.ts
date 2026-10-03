/**
 * End-to-end tests over the real HTTP and WebSocket stack: board creation via
 * the API, join and snapshot, op broadcast, rejection, cursor relay, and
 * reconnect with catchup from the in-memory op log.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import type {
  AppliedOp,
  BoardState,
  ClientMessage,
  ServerMessage,
} from '../../shared/types.js';
import { applyOp } from '../../shared/ops.js';
import { BoardStore } from '../src/store.js';
import { createSyncboardServer, type SyncboardServer } from '../src/server.js';

let server: SyncboardServer;
let store: BoardStore;
let baseUrl: string;
let wsUrl: string;

beforeAll(async () => {
  store = new BoardStore(':memory:');
  server = createSyncboardServer({ store });
  await new Promise<void>((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = server.httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
});

afterAll(async () => {
  await server.close();
  store.close();
});

class TestClient {
  private readonly queue: ServerMessage[] = [];
  private waiter: {
    predicate: (msg: ServerMessage) => boolean;
    resolve: (msg: ServerMessage) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;

  private constructor(private readonly ws: WebSocket) {}

  static async connect(url = wsUrl): Promise<TestClient> {
    const ws = new WebSocket(url);
    const client = new TestClient(ws);
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (client.waiter && client.waiter.predicate(msg)) {
        const { resolve, timer } = client.waiter;
        clearTimeout(timer);
        client.waiter = null;
        resolve(msg);
      } else {
        client.queue.push(msg);
      }
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    return client;
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Resolve with the first message (queued or incoming) matching the predicate. */
  next(predicate: (msg: ServerMessage) => boolean = () => true): Promise<ServerMessage> {
    const index = this.queue.findIndex(predicate);
    if (index >= 0) {
      const [msg] = this.queue.splice(index, 1);
      return Promise.resolve(msg as ServerMessage);
    }
    if (this.waiter) return Promise.reject(new Error('one pending wait at a time'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error('timed out waiting for message'));
      }, 5000);
      this.waiter = { predicate, resolve, reject, timer };
    });
  }

  drainQueued(predicate: (msg: ServerMessage) => boolean): ServerMessage[] {
    const matches = this.queue.filter(predicate);
    for (const m of matches) {
      this.queue.splice(this.queue.indexOf(m), 1);
    }
    return matches;
  }

  close(): void {
    this.ws.close();
  }
}

async function createBoard(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/boards`, { method: 'POST' });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  expect(body.id).toMatch(/^[A-Za-z0-9]{8}$/);
  return body.id;
}

const isSnapshot = (m: ServerMessage): m is Extract<ServerMessage, { type: 'snapshot' }> =>
  m.type === 'snapshot';
const isOps = (m: ServerMessage): m is Extract<ServerMessage, { type: 'ops' }> =>
  m.type === 'ops';

function applyAll(state: BoardState, ops: AppliedOp[]): BoardState {
  let next = state;
  for (const entry of ops) {
    const result = applyOp(next, entry.op);
    if (!result.ok) throw new Error(`broadcast op failed to apply: ${result.reason}`);
    result.state.version = entry.version;
    next = result.state;
  }
  return next;
}

describe('HTTP API', () => {
  it('creates boards and reports their existence', async () => {
    const id = await createBoard();
    const found = await fetch(`${baseUrl}/api/boards/${id}`);
    expect(found.status).toBe(200);
    const missing = await fetch(`${baseUrl}/api/boards/nope1234`);
    expect(missing.status).toBe(404);
  });

  it('responds on the health endpoint', async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
  });
});

describe('WebSocket protocol', () => {
  it('rejects entity ids used on another board without throwing or advancing the board', async () => {
    const boardId = await createBoard();
    const otherBoard = await createBoard();
    const a = await TestClient.connect();
    const b = await TestClient.connect();
    try {
      a.send({ type: 'join', boardId, clientId: 'clientAAA', name: 'Alice' });
      const first = await a.next(isSnapshot);
      b.send({ type: 'join', boardId: otherBoard, clientId: 'clientBBB', name: 'Bob' });
      const second = await b.next(isSnapshot);
      if (!isSnapshot(first) || !isSnapshot(second)) throw new Error('expected snapshots');
      a.send({ type: 'op', opId: 'createSame1', baseVersion: 0,
        op: { type: 'createCard', cardId: 'globalCard1', columnId: first.state.columns[0]!.id, title: 'First board' } });
      await a.next(isOps);
      b.send({ type: 'op', opId: 'createSame2', baseVersion: 0,
        op: { type: 'createCard', cardId: 'globalCard1', columnId: second.state.columns[0]!.id, title: 'Second board' } });
      expect(await b.next((m) => m.type === 'reject')).toMatchObject({ reason: 'duplicate_id', version: 0 });
      b.send({ type: 'op', opId: 'createSame3', baseVersion: 0,
        op: { type: 'createColumn', columnId: first.state.columns[0]!.id, title: 'Conflicting column' } });
      expect(await b.next((m) => m.type === 'reject')).toMatchObject({ reason: 'duplicate_id', version: 0 });
      expect(store.loadBoard(otherBoard)).toEqual(second.state);
      expect(store.loadBoard(boardId)?.cards).toHaveLength(1);
    } finally {
      a.close();
      b.close();
    }
  });

  it('acknowledges retries once, rejects changed intent ids, and scopes ids to the actor', async () => {
    const boardId = await createBoard();
    const a = await TestClient.connect();
    const b = await TestClient.connect();
    try {
      a.send({ type: 'join', boardId, clientId: 'clientAAA', name: 'Alice' });
      const snapshot = await a.next(isSnapshot);
      if (!isSnapshot(snapshot)) throw new Error('expected snapshot');
      const columnId = snapshot.state.columns[0]!.id;
      const message: Extract<ClientMessage, { type: 'op' }> = {
        type: 'op', opId: 'sameOp01', baseVersion: 0,
        op: { type: 'renameColumn', columnId, title: 'Alice renamed this' },
      };
      a.send(message);
      await a.next(isOps);
      a.send(message);
      expect(await a.next((m) => m.type === 'ack')).toEqual({ type: 'ack', opId: 'sameOp01', version: 1 });
      a.send({ ...message, op: { type: 'renameColumn', columnId, title: 'Reused id' } });
      expect(await a.next((m) => m.type === 'reject')).toMatchObject({ reason: 'invalid_op', version: 1 });

      b.send({ type: 'join', boardId, clientId: 'clientBBB', name: 'Bob' });
      await b.next(isSnapshot);
      b.send({ ...message, op: { type: 'renameColumn', columnId, title: 'Bob uses his own id' } });
      const applied = await b.next(isOps);
      if (!isOps(applied)) throw new Error('expected op');
      expect(applied.ops[0]?.version).toBe(2);
      expect(store.loadBoard(boardId)?.columns[0]?.title).toBe('Bob uses his own id');
    } finally {
      a.close();
      b.close();
    }
  });

  it('preserves a later peer edit when an acknowledged intent is resent after a server restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syncboard-restart-'));
    const dbPath = path.join(dir, 'board.db');
    let durableStore = new BoardStore(dbPath);
    let restartServer = createSyncboardServer({ store: durableStore });
    const listen = async () => {
      await new Promise<void>((resolve) => restartServer.httpServer.listen(0, '127.0.0.1', resolve));
      const { port } = restartServer.httpServer.address() as AddressInfo;
      return `ws://127.0.0.1:${port}/ws`;
    };
    try {
      const original = durableStore.createBoard();
      const first = await TestClient.connect(await listen());
      first.send({ type: 'join', boardId: original.id, clientId: 'clientAAA', name: 'Alice' });
      await first.next(isSnapshot);
      const message: Extract<ClientMessage, { type: 'op' }> = {
        type: 'op', opId: 'retryOp1', baseVersion: 0,
        op: { type: 'renameColumn', columnId: original.columns[0]!.id, title: 'Earlier edit' },
      };
      first.send(message);
      await first.next(isOps);
      // A subsequent accepted edit must survive an old resend.
      const peer = await TestClient.connect(`ws://127.0.0.1:${(restartServer.httpServer.address() as AddressInfo).port}/ws`);
      peer.send({ type: 'join', boardId: original.id, clientId: 'clientBBB', name: 'Bob' });
      await peer.next(isSnapshot);
      peer.send({ ...message, opId: 'laterOp1', op: { type: 'renameColumn', columnId: original.columns[0]!.id, title: 'Later peer edit' } });
      await peer.next(isOps);
      await restartServer.close();
      durableStore.close();

      durableStore = new BoardStore(dbPath);
      restartServer = createSyncboardServer({ store: durableStore });
      const rejoined = await TestClient.connect(await listen());
      rejoined.send({ type: 'join', boardId: original.id, clientId: 'clientAAA', name: 'Alice', sinceVersion: 0 });
      const snapshot = await rejoined.next(isSnapshot);
      if (!isSnapshot(snapshot)) throw new Error('expected snapshot after log loss');
      expect(snapshot.state.version).toBe(2);
      rejoined.send(message);
      expect(await rejoined.next((m) => m.type === 'ack')).toEqual({ type: 'ack', opId: 'retryOp1', version: 1 });
      rejoined.send({ type: 'join', boardId: original.id, clientId: 'clientAAA', name: 'Alice' });
      const afterRetry = await rejoined.next(isSnapshot);
      if (!isSnapshot(afterRetry)) throw new Error('expected resync snapshot');
      expect(afterRetry.state).toEqual(snapshot.state);
      expect(afterRetry.state.columns[0]?.title).toBe('Later peer edit');
      rejoined.close();
    } finally {
      await restartServer.close();
      durableStore.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects joining an unknown board', async () => {
    const client = await TestClient.connect();
    client.send({ type: 'join', boardId: 'missing9', clientId: 'clientX1', name: 'Ghost' });
    const msg = await client.next((m) => m.type === 'error');
    expect(msg).toMatchObject({ type: 'error', code: 'board_not_found' });
    client.close();
  });

  it('syncs two clients: snapshot, ops broadcast, catchup join, rejection, cursors', async () => {
    const boardId = await createBoard();

    // Client A joins fresh and receives a full snapshot.
    const a = await TestClient.connect();
    a.send({ type: 'join', boardId, clientId: 'clientAAA', name: 'Alice' });
    const snapshotMsg = await a.next(isSnapshot);
    if (!isSnapshot(snapshotMsg)) throw new Error('expected snapshot');
    let aState = snapshotMsg.state;
    expect(aState.version).toBe(0);
    expect(aState.columns).toHaveLength(3);
    const todo = aState.columns[0];
    if (!todo) throw new Error('expected default columns');

    // A creates a card; the broadcast echoes A's opId and actorId.
    a.send({
      type: 'op',
      opId: 'opAAA0001',
      baseVersion: aState.version,
      op: { type: 'createCard', cardId: 'cardWs01', columnId: todo.id, title: 'Hello' },
    });
    const created = await a.next(isOps);
    if (!isOps(created)) throw new Error('expected ops');
    expect(created.ops).toHaveLength(1);
    expect(created.ops[0]).toMatchObject({
      version: 1,
      actorId: 'clientAAA',
      opId: 'opAAA0001',
    });
    aState = applyAll(aState, created.ops);

    // Client B joins with sinceVersion 0 and gets a catchup, not a snapshot.
    const b = await TestClient.connect();
    b.send({ type: 'join', boardId, clientId: 'clientBBB', name: 'Bob', sinceVersion: 0 });
    const catchup = await b.next(isOps);
    if (!isOps(catchup)) throw new Error('expected catchup ops');
    expect(catchup.catchup).toBe(true);
    expect(catchup.ops.map((o) => o.version)).toEqual([1]);
    let bState = applyAll(snapshotMsg.state, catchup.ops);
    expect(bState).toEqual(aState);

    // Presence now lists both peers on both clients.
    const presence = await b.next(
      (m) => m.type === 'presence' && m.peers.length === 2,
    );
    if (presence.type !== 'presence') throw new Error('expected presence');
    expect(presence.peers.map((p) => p.name).sort()).toEqual(['Alice', 'Bob']);

    // B moves the card; A receives and applies the same op.
    const doing = aState.columns[1];
    if (!doing) throw new Error('expected second column');
    b.send({
      type: 'op',
      opId: 'opBBB0001',
      baseVersion: bState.version,
      op: { type: 'moveCard', cardId: 'cardWs01', toColumnId: doing.id, toIndex: 0 },
    });
    const movedAtB = await b.next(isOps);
    const movedAtA = await a.next((m) => isOps(m) && !m.catchup);
    if (!isOps(movedAtB) || !isOps(movedAtA)) throw new Error('expected ops');
    expect(movedAtA.ops).toEqual(movedAtB.ops);
    aState = applyAll(aState, movedAtA.ops);
    bState = applyAll(bState, movedAtB.ops);
    expect(aState).toEqual(bState);
    expect(aState.version).toBe(2);

    // B deletes the card, then A tries to move it and is rejected gracefully.
    b.send({
      type: 'op',
      opId: 'opBBB0002',
      baseVersion: bState.version,
      op: { type: 'deleteCard', cardId: 'cardWs01' },
    });
    const deletedAtA = await a.next((m) => isOps(m) && !m.catchup);
    if (!isOps(deletedAtA)) throw new Error('expected ops');
    aState = applyAll(aState, deletedAtA.ops);

    a.send({
      type: 'op',
      opId: 'opAAA0002',
      baseVersion: 2,
      op: { type: 'moveCard', cardId: 'cardWs01', toColumnId: todo.id, toIndex: 0 },
    });
    const rejection = await a.next((m) => m.type === 'reject');
    expect(rejection).toMatchObject({
      type: 'reject',
      opId: 'opAAA0002',
      reason: 'card_not_found',
      version: 3,
    });

    // Cursor updates relay to the other client only.
    a.send({ type: 'cursor', x: 120, y: 340, visible: true });
    const cursorAtB = await b.next((m) => m.type === 'cursor');
    expect(cursorAtB).toMatchObject({
      type: 'cursor',
      clientId: 'clientAAA',
      x: 120,
      y: 340,
      visible: true,
    });
    expect(a.drainQueued((m) => m.type === 'cursor')).toHaveLength(0);

    a.close();
    b.close();
  });

  it('replays missed ops from the log on reconnect', async () => {
    const boardId = await createBoard();

    const a = await TestClient.connect();
    a.send({ type: 'join', boardId, clientId: 'clientAAA', name: 'Alice' });
    const snapshotMsg = await a.next(isSnapshot);
    if (!isSnapshot(snapshotMsg)) throw new Error('expected snapshot');
    let aState = snapshotMsg.state;
    const todo = aState.columns[0];
    if (!todo) throw new Error('expected default columns');

    // A second client joins, records its version, then disconnects.
    let b = await TestClient.connect();
    b.send({ type: 'join', boardId, clientId: 'clientBBB', name: 'Bob', sinceVersion: 0 });
    await b.next(isOps);
    let bState = structuredClone(snapshotMsg.state);
    b.close();

    // While B is away, A applies two ops.
    a.send({
      type: 'op',
      opId: 'opAAA1001',
      baseVersion: aState.version,
      op: { type: 'createCard', cardId: 'cardRe01', columnId: todo.id, title: 'While away' },
    });
    const first = await a.next(isOps);
    if (!isOps(first)) throw new Error('expected ops');
    aState = applyAll(aState, first.ops);
    a.send({
      type: 'op',
      opId: 'opAAA1002',
      baseVersion: aState.version,
      op: { type: 'createColumn', columnId: 'colRe01', title: 'New lane' },
    });
    const second = await a.next(isOps);
    if (!isOps(second)) throw new Error('expected ops');
    aState = applyAll(aState, second.ops);
    expect(aState.version).toBe(2);

    // B reconnects with its last known version and receives exactly the missed ops.
    b = await TestClient.connect();
    b.send({
      type: 'join',
      boardId,
      clientId: 'clientBBB',
      name: 'Bob',
      sinceVersion: bState.version,
    });
    const catchup = await b.next(isOps);
    if (!isOps(catchup)) throw new Error('expected catchup');
    expect(catchup.catchup).toBe(true);
    expect(catchup.ops.map((o) => o.version)).toEqual([1, 2]);
    bState = applyAll(bState, catchup.ops);
    expect(bState).toEqual(aState);

    a.close();
    b.close();
  });

  it('falls back to a snapshot when the client is too far behind', async () => {
    const boardId = await createBoard();
    const a = await TestClient.connect();
    // sinceVersion ahead of the server forces a snapshot.
    a.send({
      type: 'join',
      boardId,
      clientId: 'clientAAA',
      name: 'Alice',
      sinceVersion: 999,
    });
    const msg = await a.next((m) => m.type === 'snapshot' || m.type === 'ops');
    expect(msg.type).toBe('snapshot');
    a.close();
  });
});
