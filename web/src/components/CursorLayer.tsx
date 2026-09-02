import { useSyncExternalStore } from 'react';
import type { BoardClient } from '../lib/boardClient';
import { CursorIcon } from './icons';

interface CursorLayerProps {
  client: BoardClient;
}

/**
 * Live cursors of other people on the board, positioned in board-content
 * coordinates. Subscribes to its own store channel so high-frequency cursor
 * traffic re-renders only this layer, not the board.
 */
export function CursorLayer({ client }: CursorLayerProps) {
  const cursors = useSyncExternalStore(client.subscribeCursors, client.getCursors);

  return (
    <div className="cursor-layer" aria-hidden>
      {cursors.map((cursor) => (
        <div
          key={cursor.clientId}
          className="cursor"
          style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
        >
          <span style={{ color: cursor.color }}>
            <CursorIcon />
          </span>
          <span className="cursor-name" style={{ backgroundColor: cursor.color }}>
            {cursor.name}
          </span>
        </div>
      ))}
    </div>
  );
}
