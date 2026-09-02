/**
 * HTTP and WebSocket wiring.
 *
 * createSyncboardServer builds the whole server around a BoardStore without
 * binding to a port, which keeps it directly usable from tests.
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { parseClientMessage } from './protocol.js';
import { Room, RoomManager } from './room.js';
import type { BoardStore } from './store.js';
import { isValidId } from '../../shared/ids.js';
import type { ServerMessage } from '../../shared/types.js';

export interface SyncboardServerOptions {
  store: BoardStore;
  /** Absolute path to the built web app; omit or pass null to skip static serving. */
  webDistPath?: string | null;
}

export interface SyncboardServer {
  httpServer: http.Server;
  close(): Promise<void>;
}

const JOIN_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

function sendMessage(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function createSyncboardServer(options: SyncboardServerOptions): SyncboardServer {
  const { store, webDistPath } = options;
  const rooms = new RoomManager(store);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/boards', (_req, res) => {
    const state = store.createBoard();
    res.status(201).json({ id: state.id });
  });

  app.get('/api/boards/:boardId', (req, res) => {
    const { boardId } = req.params;
    if (!isValidId(boardId) || !store.hasBoard(boardId)) {
      res.status(404).json({ error: 'board_not_found' });
      return;
    }
    const room = rooms.get(boardId);
    res.json({ id: boardId, version: room ? room.version : 0 });
  });

  if (webDistPath && fs.existsSync(path.join(webDistPath, 'index.html'))) {
    const indexHtml = path.join(webDistPath, 'index.html');
    app.use(express.static(webDistPath, { index: 'index.html', maxAge: '1h' }));
    // SPA fallback for board URLs and anything else that is not an API route.
    app.get(/^\/(?!api\/|ws$).*/, (_req, res) => {
      res.sendFile(indexHtml);
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .status(200)
        .type('text/plain')
        .send('syncboard server is running. Build the web app (npm run build -w web) to serve the UI.');
    });
  }

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  interface SocketState {
    room: Room | null;
    isAlive: boolean;
  }
  const sockets = new Map<WebSocket, SocketState>();

  wss.on('connection', (ws) => {
    const state: SocketState = { room: null, isAlive: true };
    sockets.set(ws, state);

    const joinTimer = setTimeout(() => {
      if (!state.room) ws.close(4000, 'join timeout');
    }, JOIN_TIMEOUT_MS);
    joinTimer.unref?.();

    ws.on('pong', () => {
      state.isAlive = true;
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const parsed = parseClientMessage(data.toString());
      if (!parsed.ok) {
        if (parsed.opId && state.room) {
          sendMessage(ws, {
            type: 'reject',
            opId: parsed.opId,
            reason: 'invalid_op',
            version: state.room.version,
          });
        } else {
          sendMessage(ws, { type: 'error', code: 'bad_request', message: 'malformed message' });
        }
        return;
      }

      const msg = parsed.msg;
      if (!state.room) {
        if (msg.type !== 'join') {
          sendMessage(ws, { type: 'error', code: 'bad_request', message: 'join first' });
          return;
        }
        const room = rooms.get(msg.boardId);
        if (!room) {
          sendMessage(ws, {
            type: 'error',
            code: 'board_not_found',
            message: `no board with id ${msg.boardId}`,
          });
          ws.close(4004, 'board not found');
          return;
        }
        state.room = room;
        clearTimeout(joinTimer);
        room.addClient(ws, msg);
        return;
      }

      switch (msg.type) {
        case 'join':
          // Rejoin on an open socket acts as a resync request.
          state.room.addClient(ws, msg);
          break;
        case 'op':
          state.room.handleOp(ws, msg);
          break;
        case 'cursor':
          state.room.handleCursor(ws, msg);
          break;
        case 'setName':
          state.room.handleSetName(ws, msg.name);
          break;
      }
    });

    ws.on('close', () => {
      clearTimeout(joinTimer);
      if (state.room) rooms.clientLeft(state.room, ws);
      sockets.delete(ws);
    });

    ws.on('error', () => {
      ws.terminate();
    });
  });

  const heartbeat = setInterval(() => {
    for (const [ws, state] of sockets) {
      if (!state.isAlive) {
        ws.terminate();
        continue;
      }
      state.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  const close = (): Promise<void> =>
    new Promise((resolve, reject) => {
      clearInterval(heartbeat);
      for (const ws of sockets.keys()) ws.terminate();
      wss.close();
      rooms.dispose();
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });

  return { httpServer, close };
}
