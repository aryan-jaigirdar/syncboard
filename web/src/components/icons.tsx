/** Minimal inline icon set; 16px stroke icons inheriting currentColor. */

interface IconProps {
  size?: number;
}

function base(size: number | undefined) {
  return {
    width: size ?? 16,
    height: size ?? 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
}

export function PlusIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

export function XIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function TrashIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M2.5 4.5h11M6.5 2.5h3M5.5 4.5l.5 9h4l.5-9" />
    </svg>
  );
}

export function PencilIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9.5 3.5l3 3L6 13H3v-3z" />
    </svg>
  );
}

export function CopyIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </svg>
  );
}

export function CheckIcon({ size }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 8.5l3.5 3.5L13 4.5" />
    </svg>
  );
}

export function CursorIcon({ size }: IconProps) {
  return (
    <svg
      width={size ?? 18}
      height={size ?? 18}
      viewBox="0 0 18 18"
      fill="currentColor"
      aria-hidden
    >
      <path d="M3 2l12 5.5-5 1.6L7.6 14z" stroke="rgba(0,0,0,.45)" strokeWidth="1" />
    </svg>
  );
}
