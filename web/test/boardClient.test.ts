import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardState, ClientMessage, ServerMessage } from '../../shared/types';
import type { ConnectionHandlers } from '../src/lib/connection';

const mock = vi.hoisted(() => ({ handlers: null as ConnectionHandlers | null, send: vi.fn() }));
vi.mock('../src/lib/connection', () => ({
  Connection: class {
    constructor(_url: string, handlers: ConnectionHandlers) { mock.handlers = handlers; }
    send = mock.send;
    start() {}
    stop() {}
  },
}));
vi.mock('../src/lib/session', () => ({
  getClientId: () => 'clientAlice', getName: () => 'Alice', saveName: vi.fn(),
}));

import { BoardClient } from '../src/lib/boardClient';

function state(version = 0, title = 'Original'): BoardState {
  return {
    id: 'demoBoard', version,
    columns: [{ id: 'columnTodo', title: 'To do', order: 0 }],
    cards: [{ id: 'cardTest', columnId: 'columnTodo', title, description: '', order: 0 }],
  };
}

function receive(msg: ServerMessage) { mock.handlers!.onMessage(msg); }
function sentOp(): Extract<ClientMessage, { type: 'op' }> {
  const msg = mock.send.mock.calls.at(-1)?.[0] as ClientMessage;
  if (msg.type !== 'op') throw new Error('expected an op');
  return msg;
}

beforeEach(() => {
  mock.send.mockReset();
  vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost' } });
});
afterEach(() => vi.unstubAllGlobals());

describe('BoardClient reconnect receipts', () => {
  it('drops an acknowledged retry after a snapshot and preserves a later edit', () => {
    const client = new BoardClient('demoBoard');
    receive({ type: 'snapshot', state: state(), peers: [] });
    client.intent({ type: 'editCard', cardId: 'cardTest', title: 'Earlier edit' });
    const original = sentOp();
    // The server committed the edit, another peer changed it, then restarted.
    receive({ type: 'snapshot', state: state(2, 'Later peer edit'), peers: [] });
    const retry = sentOp();
    expect(retry.opId).toBe(original.opId);
    receive({ type: 'ack', opId: original.opId, version: 1 });
    expect(client.getSnapshot().state).toEqual(state(2, 'Later peer edit'));
    expect(client.getSnapshot().notices).toEqual([]);
    mock.send.mockClear();
    receive({ type: 'snapshot', state: state(2, 'Later peer edit'), peers: [] });
    expect(mock.send).not.toHaveBeenCalled();
    client.dispose();
  });

  it('clears retries of created cards without a false collision warning', () => {
    const client = new BoardClient('demoBoard');
    receive({ type: 'snapshot', state: state(), peers: [] });
    client.intent({ type: 'createCard', cardId: 'cardNew', columnId: 'columnTodo', title: 'New card' });
    const submitted = sentOp();
    const confirmed = state(1);
    confirmed.cards.push({ id: 'cardNew', columnId: 'columnTodo', title: 'New card', description: '', order: 1 });
    receive({ type: 'snapshot', state: confirmed, peers: [] });
    receive({ type: 'ack', opId: submitted.opId, version: 1 });
    expect(client.getSnapshot().state).toEqual(confirmed);
    expect(client.getSnapshot().notices).toEqual([]);
    client.dispose();
  });
});
