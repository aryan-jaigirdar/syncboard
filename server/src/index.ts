import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BoardStore } from './store.js';
import { createSyncboardServer } from './server.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Walk up from the running module to the server package root. This works for
 * both layouts: server/src when run with tsx, and server/dist/server/src when
 * running the compiled output (the nearest package.json in either case is
 * server/package.json).
 */
function findServerRoot(): string {
  let dir = moduleDir;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return moduleDir;
}

const serverRoot = findServerRoot();

function findWebDist(): string | null {
  const candidates = [
    process.env.SYNCBOARD_WEB_DIST,
    path.resolve(serverRoot, '../web/dist'),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  return null;
}

function resolveDbPath(): string {
  const fromEnv = process.env.SYNCBOARD_DB;
  if (fromEnv) return fromEnv;
  const dataDir = path.join(serverRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, 'syncboard.db');
}

const port = Number(process.env.PORT ?? 3090);
const dbPath = resolveDbPath();
const webDistPath = findWebDist();

const store = new BoardStore(dbPath);
const { httpServer, close } = createSyncboardServer({ store, webDistPath });

httpServer.listen(port, () => {
  console.log(`syncboard listening on http://localhost:${port}`);
  console.log(`database: ${dbPath}`);
  console.log(webDistPath ? `serving web app from ${webDistPath}` : 'web app not built; API and WS only');
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  try {
    await close();
    store.close();
    process.exit(0);
  } catch (err) {
    console.error('error during shutdown', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
