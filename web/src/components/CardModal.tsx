import { useEffect, useRef, useState } from 'react';
import type { Card, CardLabel } from '../../../shared/types';
import { CARD_LABELS, LIMITS } from '../../../shared/types';
import { LABEL_COLORS } from '../../../shared/color';
import { CheckIcon, CopyIcon, TrashIcon, XIcon } from './icons';

interface CardModalProps {
  card: Card;
  onSave(title: string, description: string): void;
  onSetLabel(label: CardLabel): void;
  onDelete(): void;
  onDuplicate(): void;
  onClose(): void;
}

export function CardModal({ card, onSave, onSetLabel, onDelete, onDuplicate, onClose }: CardModalProps) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dirty = title !== card.title || description !== card.description;
  const canSave = title.trim().length > 0;
  const currentLabel: CardLabel = card.label ?? 'none';

  function save() {
    if (!canSave) return;
    if (dirty) onSave(title, description);
    onClose();
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Edit card">
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
          <span className="modal-label">Label</span>
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
      </div>
    </div>
  );
}
