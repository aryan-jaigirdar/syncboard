/**
 * Deterministic per-user color. Hashing the client id means every peer
 * derives the same color for a given user without coordination.
 */

import type { CardLabel } from './types.js';

export function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 65% 60%)`;
}

/** Display color for each named label. 'none' has no color and is omitted. */
export const LABEL_COLORS: Record<Exclude<CardLabel, 'none'>, string> = {
  red: '#e5645c',
  orange: '#e08a4a',
  yellow: '#e0c24a',
  green: '#46c08a',
  blue: '#5b8def',
  purple: '#9b7bff',
};
