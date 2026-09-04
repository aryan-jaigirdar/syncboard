import type { Card } from '../../../shared/types';
import { LABEL_COLORS } from '../../../shared/color';

interface CardItemProps {
  card: Card;
  /** Ghost cards are the floating copy under the pointer during a drag. */
  ghost?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onClick?: () => void;
}

export function CardItem({ card, ghost, onPointerDown, onClick }: CardItemProps) {
  const labelColor = card.label && card.label !== 'none' ? LABEL_COLORS[card.label] : null;
  return (
    <div
      className={ghost ? 'card card-ghost' : 'card'}
      data-card-id={ghost ? undefined : card.id}
      onPointerDown={onPointerDown}
      onClick={onClick}
      role={ghost ? undefined : 'button'}
      tabIndex={ghost ? undefined : 0}
      onKeyDown={(e) => {
        if (!ghost && (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      {labelColor && (
        <div className="card-label-strip" style={{ background: labelColor }} aria-hidden="true" />
      )}
      <div className="card-title">{card.title}</div>
      {card.description.trim().length > 0 && (
        <div className="card-desc">{card.description}</div>
      )}
    </div>
  );
}
