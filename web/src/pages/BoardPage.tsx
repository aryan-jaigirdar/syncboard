import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Card } from '../../../shared/types';
import { cardsInColumn, sortedColumns } from '../../../shared/ops';
import { genId } from '../../../shared/ids';
import { BoardClient } from '../lib/boardClient';
import { useDnd } from '../lib/dnd';
import { rememberBoard } from '../lib/session';
import { navigate } from '../App';
import { Column } from '../components/Column';
import { CardItem } from '../components/CardItem';
import { CardModal } from '../components/CardModal';
import { PresenceBar } from '../components/PresenceBar';
import { CursorLayer } from '../components/CursorLayer';
import { CheckIcon, CopyIcon, PlusIcon, XIcon } from '../components/icons';

interface BoardPageProps {
  boardId: string;
}

const CURSOR_INTERVAL_MS = 66; // about 15 updates per second

const STATUS_LABEL = {
  connecting: 'Connecting',
  online: 'Live',
  reconnecting: 'Reconnecting',
  not_found: 'Not found',
} as const;

export function BoardPage({ boardId }: BoardPageProps) {
  const client = useMemo(() => new BoardClient(boardId), [boardId]);
  useEffect(() => {
    client.start();
    return () => client.dispose();
  }, [client]);

  const snap = useSyncExternalStore(client.subscribe, client.getSnapshot);

  useEffect(() => {
    if (snap.status === 'online') rememberBoard(boardId);
  }, [boardId, snap.status]);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);
  const [columnDraft, setColumnDraft] = useState('');
  const [copied, setCopied] = useState(false);

  const { drag, onCardPointerDown, onColumnPointerDown, didDrag } = useDnd({
    scrollerRef,
    onMoveCard: (cardId, toColumnId, toIndex) =>
      client.intent({ type: 'moveCard', cardId, toColumnId, toIndex }),
    onReorderColumn: (columnId, toIndex) =>
      client.intent({ type: 'reorderColumn', columnId, toIndex }),
  });

  // Throttled cursor broadcasts in board-content coordinates.
  const lastCursorSent = useRef(0);
  const cursorTrailing = useRef<number | null>(null);
  const sendCursor = useCallback(
    (clientX: number, clientY: number) => {
      const content = contentRef.current;
      if (!content) return;
      const rect = content.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const now = Date.now();
      const elapsed = now - lastCursorSent.current;
      if (elapsed >= CURSOR_INTERVAL_MS) {
        lastCursorSent.current = now;
        client.sendCursor(x, y, true);
      } else if (cursorTrailing.current === null) {
        cursorTrailing.current = window.setTimeout(() => {
          cursorTrailing.current = null;
          lastCursorSent.current = Date.now();
          client.sendCursor(x, y, true);
        }, CURSOR_INTERVAL_MS - elapsed);
      }
    },
    [client],
  );

  const hideCursor = useCallback(() => {
    if (cursorTrailing.current !== null) {
      window.clearTimeout(cursorTrailing.current);
      cursorTrailing.current = null;
    }
    client.sendCursor(0, 0, false);
  }, [client]);

  useEffect(
    () => () => {
      if (cursorTrailing.current !== null) window.clearTimeout(cursorTrailing.current);
    },
    [],
  );

  // Auto-dismiss reject notices.
  useEffect(() => {
    if (snap.notices.length === 0) return;
    const timers = snap.notices.map((notice) =>
      window.setTimeout(() => client.dismissNotice(notice.id), 4500),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [client, snap.notices]);

  const state = snap.state;
  const editingCard: Card | null =
    (editingCardId && state?.cards.find((c) => c.id === editingCardId)) || null;

  // If the card being edited was deleted remotely, close the modal.
  useEffect(() => {
    if (editingCardId && !editingCard) setEditingCardId(null);
  }, [editingCardId, editingCard]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable; the address bar still has the link.
    }
  }

  function commitColumn() {
    const title = columnDraft.trim();
    if (title.length > 0) {
      client.intent({ type: 'createColumn', columnId: genId(12), title });
      setColumnDraft('');
    }
    setAddingColumn(false);
  }

  if (snap.status === 'not_found') {
    return (
      <div className="board-missing">
        <div className="wordmark">
          sync<span className="wordmark-accent">board</span>
        </div>
        <h1>Board not found</h1>
        <p>
          The board <code>{boardId}</code> does not exist. It may have been created
          on a different server.
        </p>
        <button className="btn btn-primary" onClick={() => navigate('/')}>
          Back to start
        </button>
      </div>
    );
  }

  const columns = state ? sortedColumns(state) : [];
  const draggedCard: Card | null =
    drag?.kind === 'card' ? (state?.cards.find((c) => c.id === drag.cardId) ?? null) : null;
  const draggedColumn =
    drag?.kind === 'column' ? (columns.find((c) => c.id === drag.columnId) ?? null) : null;

  // Column render order: during a column drag the dragged column is replaced
  // by a placeholder at the prospective slot.
  let renderColumns: (typeof columns[number] | 'placeholder')[] = columns;
  if (drag?.kind === 'column' && drag.targetIndex !== null) {
    const rest = columns.filter((c) => c.id !== drag.columnId);
    renderColumns = [
      ...rest.slice(0, drag.targetIndex),
      'placeholder',
      ...rest.slice(drag.targetIndex),
    ];
  }

  return (
    <div className="board-page">
      <header className="topbar">
        <a
          className="wordmark"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
        >
          sync<span className="wordmark-accent">board</span>
        </a>
        <div className="board-chip">
          <span className="board-chip-id">{boardId}</span>
          <button
            className="icon-btn"
            onClick={() => void copyLink()}
            aria-label="Copy board link"
            title="Copy board link"
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          </button>
        </div>
        <span className={`status status-${snap.status}`}>
          <span className="status-dot" />
          {STATUS_LABEL[snap.status]}
        </span>
        <div className="topbar-spacer" />
        <PresenceBar peers={snap.peers} self={snap.self} onRename={(name) => client.setName(name)} />
      </header>

      {!state ? (
        <div className="board-loading">Loading board</div>
      ) : (
        <div
          className="board-scroller"
          ref={scrollerRef}
          onPointerMove={(e) => sendCursor(e.clientX, e.clientY)}
          onPointerLeave={hideCursor}
        >
          <div className="board-content" ref={contentRef}>
            {renderColumns.map((column) => {
              if (column === 'placeholder') {
                return (
                  <div
                    key="column-placeholder"
                    className="column-placeholder"
                    style={{
                      width: drag?.kind === 'column' ? drag.width : undefined,
                      height: drag?.kind === 'column' ? drag.height : undefined,
                    }}
                  />
                );
              }
              if (drag?.kind === 'column' && drag.targetIndex !== null && column.id === drag.columnId) {
                return null;
              }
              const columnCards = cardsInColumn(state, column.id).filter(
                (c) => !(drag?.kind === 'card' && c.id === drag.cardId),
              );
              const cardPlaceholder =
                drag?.kind === 'card' && drag.target?.columnId === column.id
                  ? { index: drag.target.index, height: drag.height }
                  : null;
              return (
                <Column
                  key={column.id}
                  column={column}
                  index={columns.findIndex((c) => c.id === column.id)}
                  cards={columnCards}
                  cardPlaceholder={cardPlaceholder}
                  onColumnPointerDown={onColumnPointerDown}
                  onCardPointerDown={onCardPointerDown}
                  onOpenCard={setEditingCardId}
                  onRename={(title) =>
                    client.intent({ type: 'renameColumn', columnId: column.id, title })
                  }
                  onDelete={() => client.intent({ type: 'deleteColumn', columnId: column.id })}
                  onAddCard={(title) =>
                    client.intent({
                      type: 'createCard',
                      cardId: genId(12),
                      columnId: column.id,
                      title,
                    })
                  }
                  didDrag={didDrag}
                />
              );
            })}

            {addingColumn ? (
              <div className="add-column-form">
                <input
                  className="column-title-input"
                  value={columnDraft}
                  autoFocus
                  placeholder="Column title"
                  onChange={(e) => setColumnDraft(e.target.value)}
                  onBlur={commitColumn}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitColumn();
                    if (e.key === 'Escape') {
                      setColumnDraft('');
                      setAddingColumn(false);
                    }
                  }}
                  aria-label="New column title"
                />
                <button
                  className="icon-btn"
                  aria-label="Cancel adding column"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setColumnDraft('');
                    setAddingColumn(false);
                  }}
                >
                  <XIcon size={14} />
                </button>
              </div>
            ) : (
              <button className="add-column-btn" onClick={() => setAddingColumn(true)}>
                <PlusIcon size={14} />
                Add column
              </button>
            )}

            <CursorLayer client={client} />
          </div>
        </div>
      )}

      {drag?.kind === 'card' && draggedCard && (
        <div
          className="drag-overlay"
          style={{
            transform: `translate(${drag.pointerX - drag.grabX}px, ${drag.pointerY - drag.grabY}px)`,
            width: drag.width,
          }}
        >
          <CardItem card={draggedCard} ghost />
        </div>
      )}
      {drag?.kind === 'column' && draggedColumn && state && (
        <div
          className="drag-overlay"
          style={{
            transform: `translate(${drag.pointerX - drag.grabX}px, ${drag.pointerY - drag.grabY}px)`,
            width: drag.width,
          }}
        >
          <div className="column column-ghost">
            <header className="column-header">
              <span className="column-title">{draggedColumn.title}</span>
              <span className="column-count">
                {cardsInColumn(state, draggedColumn.id).length}
              </span>
            </header>
          </div>
        </div>
      )}

      {editingCard && (
        <CardModal
          card={editingCard}
          onSave={(title, description) =>
            client.intent({ type: 'editCard', cardId: editingCard.id, title, description })
          }
          onDelete={() => {
            client.intent({ type: 'deleteCard', cardId: editingCard.id });
            setEditingCardId(null);
          }}
          onDuplicate={() => {
            client.intent({
              type: 'duplicateCard',
              cardId: editingCard.id,
              newCardId: genId(12),
            });
            setEditingCardId(null);
          }}
          onClose={() => setEditingCardId(null)}
        />
      )}

      {snap.notices.length > 0 && (
        <div className="toasts" role="status">
          {snap.notices.map((notice) => (
            <div key={notice.id} className="toast">
              <span>{notice.text}</span>
              <button
                className="icon-btn"
                aria-label="Dismiss notification"
                onClick={() => client.dismissNotice(notice.id)}
              >
                <XIcon size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
