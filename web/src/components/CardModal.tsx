import { useEffect, useRef, useState } from 'react';
import type { Card } from '../../../shared/types';
import { LIMITS } from '../../../shared/types';
import { TrashIcon } from './icons';

interface CardModalProps {
  card: Card;
  onSave(title: string, description: string): void;
  onDelete(): void;
  onClose(): void;
}

export function CardModal({ card, onSave, onDelete, onClose }: CardModalProps) {
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
