import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CardLabel, Op } from '../../shared/types.js';
import { applyOp } from '../../shared/ops.js';
import { genId } from '../../shared/ids.js';
import { BoardStore } from '../src/store.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.SYNCBOARD_DB ?? path.join(serverRoot, 'data', 'syncboard.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const store = new BoardStore(dbPath);

try {
  let state = store.createBoard();
  function apply(op: Op) {
    const result = applyOp(state, op);
    if (!result.ok) throw new Error(`demo op rejected: ${result.reason}`);
    result.state.version = state.version + 1;
    store.persist(state, result.state, op);
    state = result.state;
  }

  const groups: { title: string; cards: [string, string, CardLabel][] }[] = [
    { title: 'Next up', cards: [
      ['Offline queue', 'Keep edits on the device, then reconcile on reconnect.', 'purple'],
      ['Accessible navigation', 'Check VoiceOver, focus order, and larger text.', 'blue'],
      ['Release notes', 'Summarize changes for the beta group.', 'none'],
    ] },
    { title: 'In progress', cards: [
      ['Reconnect recovery', 'Resume from a snapshot without replaying an accepted edit.', 'green'],
      ['Touch interactions', 'Move cards with a tap. Keep horizontal swipes for scrolling.', 'orange'],
      ['Two-client review', 'Open the same board in another browser and compare confirmed state.', 'blue'],
    ] },
    { title: 'Shipped', cards: [
      ['Shared sync engine', 'The browser and server apply the same validated operations.', 'green'],
      ['Durable receipts', 'Commit each operation receipt and board mutation together in SQLite.', 'purple'],
      ['Keyboard controls', 'Edit and move cards without a pointer.', 'yellow'],
    ] },
  ];

  groups.forEach((group, index) => {
    const columnId = state.columns[index]!.id;
    apply({ type: 'renameColumn', columnId, title: group.title });
    for (const [title, description, label] of group.cards) {
      const cardId = genId();
      apply({ type: 'createCard', cardId, columnId, title, description });
      if (label !== 'none') apply({ type: 'setCardLabel', cardId, label });
    }
  });

  console.log(`Demo board: http://localhost:${process.env.PORT ?? 3090}/b/${state.id}`);
  console.log(`Development URL: http://localhost:5173/b/${state.id}`);
  console.log(`Database: ${dbPath}`);
  console.log('Sample planning content. This creates a fresh board and keeps existing boards.');
} finally {
  store.close();
}
