import type { Card } from '../../../shared/types';

interface CardItemProps {
  card: Card;
  /** Ghost cards are the floating copy under the pointer during a drag. */
  ghost?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onClick?: () => void;
}

export function CardItem({ card, ghost, onPointerDown, onClick }: CardItemProps) {
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
      <div className="card-title">{card.title}</div>
      {card.description.trim().length > 0 && (
        <div className="card-desc">{card.description}</div>
      )}
    </div>
  );
}
