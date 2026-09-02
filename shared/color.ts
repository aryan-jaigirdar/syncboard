/**
 * Deterministic per-user color. Hashing the client id means every peer
 * derives the same color for a given user without coordination.
 */

export function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 65% 60%)`;
}
