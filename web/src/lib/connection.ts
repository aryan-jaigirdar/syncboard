/**
 * A WebSocket wrapper with exponential backoff reconnection.
 *
 * The wrapper only manages the socket lifecycle. What to send on (re)open,
 * such as the join message with the last known version, is the caller's job
 * via the onOpen callback.
 */

import type { ClientMessage, ServerMessage } from '../../../shared/types';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'stopped';

export interface ConnectionHandlers {
  onOpen(): void;
  onMessage(msg: ServerMessage): void;
  onStatus(status: ConnectionStatus): void;
}

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 10_000;

export class Connection {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private stopped = false;
  private timer: number | null = null;

  constructor(
    private readonly url: string,
    private readonly handlers: ConnectionHandlers,
  ) {}

  start(): void {
    this.stopped = false;
    this.dial('connecting');
  }

  private dial(status: ConnectionStatus): void {
    if (this.stopped) return;
    this.handlers.onStatus(status);

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      if (this.stopped) {
        ws.close();
        return;
      }
      this.attempts = 0;
      this.handlers.onStatus('open');
      this.handlers.onOpen();
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      this.handlers.onMessage(msg);
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.stopped) return;
      const delay =
        Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** this.attempts) + Math.random() * 300;
      this.attempts += 1;
      this.handlers.onStatus('reconnecting');
      this.timer = window.setTimeout(() => this.dial('reconnecting'), delay);
    };

    ws.onerror = () => {
      // onclose follows and drives the retry.
    };
  }

  send(msg: ClientMessage): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  get isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.handlers.onStatus('stopped');
    this.ws?.close();
    this.ws = null;
  }
}
