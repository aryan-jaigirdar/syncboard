import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../src/lib/connection';
import type { ServerMessage } from '../../shared/types';

class Socket {
  static readonly OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => { this.readyState = 3; });

  constructor(readonly url: string) { Socket.instances.push(this); }
  open() { this.readyState = Socket.OPEN; this.onopen?.(); }
}

beforeEach(() => {
  vi.useFakeTimers();
  Socket.instances = [];
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('window', { setTimeout, clearTimeout });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  const handlers = { onOpen: vi.fn(), onMessage: vi.fn(), onStatus: vi.fn() };
  return { connection: new Connection('ws://localhost/ws', handlers), handlers };
}

describe('Connection lifecycle', () => {
  it('keeps the restarted socket when a stopped socket closes late', () => {
    const { connection, handlers } = setup();
    connection.start();
    const old = Socket.instances[0]!;
    connection.stop();
    connection.start();
    const active = Socket.instances[1]!;
    active.open();
    old.onclose?.();

    expect(connection.isOpen).toBe(true);
    connection.send({ type: 'setName', name: 'Alice' });
    expect(active.send).toHaveBeenCalledWith(JSON.stringify({ type: 'setName', name: 'Alice' }));
    vi.runAllTimers();
    expect(Socket.instances).toHaveLength(2);
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    connection.stop();
  });

  it('ignores messages and open events from a replaced socket', () => {
    const { connection, handlers } = setup();
    connection.start();
    const old = Socket.instances[0]!;
    connection.stop();
    connection.start();
    const active = Socket.instances[1]!;
    old.open();
    old.onmessage?.({ data: JSON.stringify({ type: 'presence', peers: [] } satisfies ServerMessage) });
    expect(handlers.onOpen).not.toHaveBeenCalled();
    expect(handlers.onMessage).not.toHaveBeenCalled();
    active.open();
    expect(connection.isOpen).toBe(true);
    connection.stop();
  });

  it('starts once and cancels reconnect timers when stopped', () => {
    const { connection } = setup();
    connection.start();
    connection.start();
    expect(Socket.instances).toHaveLength(1);
    Socket.instances[0]!.onclose?.();
    connection.start();
    expect(Socket.instances).toHaveLength(1);
    connection.stop();
    vi.runAllTimers();
    expect(Socket.instances).toHaveLength(1);
  });
});
