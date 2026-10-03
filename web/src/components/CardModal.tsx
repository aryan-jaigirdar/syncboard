import { useEffect, useRef, useState } from 'react';
import type { Card, CardLabel, Column } from '../../../shared/types';
import { CARD_LABELS, LIMITS } from '../../../shared/types';
import { LABEL_COLORS } from '../../../shared/color';
import { CheckIcon, CopyIcon, TrashIcon, XIcon } from './icons';

interface CardModalProps {
  card: Card;
  columns: Column[];
  cards: Card[];
  onMove(columnId: string, index: number): void;
  onSave(title: string, description: string): void;
  onSetLabel(label: CardLabel): void;
  onDelete(): void;
  onDuplicate(): void;
  onClose(): void;
}

export function CardModal({
  card,
  columns,
  cards,
  onMove,
  onSave,
  onSetLabel,
  onDelete,
  onDuplicate,
  onClose,
}: CardModalProps) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [destination, setDestination] = useState(card.columnId);
  const [position, setPosition] = useState(card.order);
  const destinationSize = cards.filter((c) => c.columnId === destination && c.id !== card.id).length;
  const moveIndex = Math.min(position, destinationSize);
  const canMove = columns.some((c) => c.id === destination) &&
    (destination !== card.columnId || moveIndex !== card.order);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    titleRef.current?.focus();
    titleRef.current?.select();
    return () => dialog?.close();
  }, []);

  const dirty = title !== card.title || description !== card.description;
  const canSave = title.trim().length > 0;
  const currentLabel: CardLabel = card.label ?? 'none';

  function save() {
    if (!canSave) return;
    if (dirty) onSave(title, description);
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-label="Edit card"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        if (e.target === e.currentTarget &&
            (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)) {
          onClose();
        }
      }}
    >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input
            ref={titleRef}
            className="modal-title-input"
            value={title}
            maxLength={LIMITS.titleLength}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Card title"
            aria-label="Card title"
          />
          <label className="modal-label" htmlFor="card-description">
            Description
          </label>
          <textarea
            id="card-description"
            className="modal-desc-input"
            value={description}
            maxLength={LIMITS.descriptionLength}
            rows={6}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add more detail"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save();
            }}
          />
          <span className="modal-label">Label (saves immediately)</span>
          <div className="label-picker" role="group" aria-label="Card label">
            {CARD_LABELS.map((label) => {
              const active = currentLabel === label;
              const color = label === 'none' ? null : LABEL_COLORS[label];
              const className =
                'label-swatch' +
                (label === 'none' ? ' label-swatch-none' : '') +
                (active ? ' label-swatch-active' : '');
              return (
                <button
                  key={label}
                  type="button"
                  className={className}
                  style={color ? { background: color } : undefined}
                  aria-label={label === 'none' ? 'No label' : label}
                  aria-pressed={active}
                  title={label === 'none' ? 'No label' : label}
                  onClick={() => onSetLabel(label)}
                >
                  {label === 'none' ? (
                    <XIcon size={12} />
                  ) : active ? (
                    <CheckIcon size={12} />
                  ) : null}
                </button>
              );
            })}
          </div>
          <fieldset className="move-card">
            <legend className="modal-label">Move card</legend>
            <div className="move-card-controls">
              <label>
                <span className="visually-hidden">Destination column</span>
                <select
                  value={destination}
                  onChange={(e) => {
                    setDestination(e.target.value);
                    setPosition(cards.filter((c) => c.columnId === e.target.value && c.id !== card.id).length);
                  }}
                >
                  {columns.map((column) => (
                    <option key={column.id} value={column.id}>{column.title}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="visually-hidden">Position in column</span>
                <select value={moveIndex} onChange={(e) => setPosition(Number(e.target.value))}>
                  {Array.from({ length: destinationSize + 1 }, (_, index) => (
                    <option key={index} value={index}>Position {index + 1}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn"
                disabled={!canMove || !canSave}
                onClick={() => {
                  if (dirty) onSave(title, description);
                  onMove(destination, moveIndex);
                  onClose();
                }}
              >
                Move
              </button>
            </div>
          </fieldset>
          <div className="modal-footer">
            {confirmingDelete ? (
              <span className="confirm-group">
                <span className="confirm-label">Delete this card?</span>
                <button type="button" className="btn btn-danger" onClick={onDelete}>
                  Delete
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setConfirmingDelete(false)}
                >
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-danger-ghost"
                onClick={() => setConfirmingDelete(true)}
              >
                <TrashIcon size={14} />
                Delete card
              </button>
            )}
            {!confirmingDelete && (
              <button type="button" className="btn btn-ghost" onClick={onDuplicate}>
                <CopyIcon size={14} />
                Duplicate
              </button>
            )}
            <span className="modal-footer-spacer" />
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!canSave}>
              Save
            </button>
          </div>
        </form>
    </dialog>
  );
}
