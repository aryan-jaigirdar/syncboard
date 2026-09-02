import { useEffect, useRef, useState } from 'react';
import type { Card, Column as ColumnType } from '../../../shared/types';
import { LIMITS } from '../../../shared/types';
import { CardItem } from './CardItem';
import { PlusIcon, TrashIcon, XIcon } from './icons';

interface ColumnProps {
  column: ColumnType;
  /** Position among sorted columns; used as the drag origin index. */
  index: number;
  /** Sorted cards of this column, with a dragged card already filtered out. */
  cards: Card[];
  /** When a dragged card hovers this column: slot index and source card height. */
  cardPlaceholder: { index: number; height: number } | null;
  onColumnPointerDown(e: React.PointerEvent, columnId: string, index: number): void;
  onCardPointerDown(e: React.PointerEvent, cardId: string, columnId: string, index: number): void;
  onOpenCard(cardId: string): void;
  onRename(title: string): void;
  onDelete(): void;
  onAddCard(title: string): void;
  didDrag: React.MutableRefObject<boolean>;
}

export function Column({
  column,
  index,
  cards,
  cardPlaceholder,
  onColumnPointerDown,
  onCardPointerDown,
  onOpenCard,
  onRename,
  onDelete,
  onAddCard,
  didDrag,
}: ColumnProps) {
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(column.title);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [composing, setComposing] = useState(false);
  const [cardDraft, setCardDraft] = useState('');
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (composing) composerRef.current?.focus();
  }, [composing]);

  function commitRename() {
    setRenaming(false);
    const title = titleDraft.trim();
    if (title.length > 0 && title !== column.title) onRename(title);
  }

  function commitCard() {
    const title = cardDraft.trim();
    if (title.length > 0) {
      onAddCard(title);
      setCardDraft('');
      composerRef.current?.focus();
    }
  }

  const items: React.ReactNode[] = [];
  cards.forEach((card, cardIndex) => {
    if (cardPlaceholder && cardPlaceholder.index === cardIndex) {
      items.push(
        <div
          key="placeholder"
          className="card-placeholder"
          style={{ height: cardPlaceholder.height }}
        />,
      );
    }
    items.push(
      <CardItem
        key={card.id}
        card={card}
        onPointerDown={(e) => onCardPointerDown(e, card.id, column.id, cardIndex)}
        onClick={() => {
          if (!didDrag.current) onOpenCard(card.id);
        }}
      />,
    );
  });
  if (cardPlaceholder && cardPlaceholder.index >= cards.length) {
    items.push(
      <div
        key="placeholder"
        className="card-placeholder"
        style={{ height: cardPlaceholder.height }}
      />,
    );
  }

  return (
    <section className="column" data-column-id={column.id} aria-label={column.title}>
      <header
        className="column-header"
        onPointerDown={(e) => onColumnPointerDown(e, column.id, index)}
      >
        {renaming ? (
          <input
            className="column-title-input"
            value={titleDraft}
            maxLength={LIMITS.titleLength}
            autoFocus
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') {
                setTitleDraft(column.title);
                setRenaming(false);
              }
            }}
            aria-label="Column title"
          />
        ) : (
          <button
            className="column-title"
            onClick={() => {
              setTitleDraft(column.title);
              setRenaming(true);
            }}
            title="Rename column"
          >
            {column.title}
          </button>
        )}
        <span className="column-count">{cards.length}</span>
        {confirmingDelete ? (
          <span className="confirm-group">
            <button className="btn btn-danger btn-small" onClick={onDelete}>
              Delete
            </button>
            <button
              className="btn btn-ghost btn-small"
              onClick={() => setConfirmingDelete(false)}
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            className="icon-btn column-delete"
            aria-label={`Delete column ${column.title}`}
            title="Delete column"
            onClick={() => setConfirmingDelete(true)}
          >
            <TrashIcon size={14} />
          </button>
        )}
      </header>

      <div className="card-list" data-cardlist>
        {items}
      </div>

      <footer className="column-footer">
        {composing ? (
          <div className="composer">
            <textarea
              ref={composerRef}
              className="composer-input"
              value={cardDraft}
              maxLength={LIMITS.titleLength}
              rows={2}
              placeholder="Card title"
              onChange={(e) => setCardDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  commitCard();
                }
                if (e.key === 'Escape') {
                  setComposing(false);
                  setCardDraft('');
                }
              }}
            />
            <div className="composer-actions">
              <button className="btn btn-primary btn-small" onClick={commitCard}>
                Add card
              </button>
              <button
                className="icon-btn"
                aria-label="Close card composer"
                onClick={() => {
                  setComposing(false);
                  setCardDraft('');
                }}
              >
                <XIcon size={14} />
              </button>
            </div>
          </div>
        ) : (
          <button className="add-card-btn" onClick={() => setComposing(true)}>
            <PlusIcon size={14} />
            Add card
          </button>
        )}
      </footer>
    </section>
  );
}
