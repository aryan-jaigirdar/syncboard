/**
 * Per-tab identity and per-browser preferences.
 *
 * The client id lives in sessionStorage so each tab is its own presence peer.
 * The display name lives in localStorage so it follows the user across boards
 * and sessions. All storage access is guarded; private browsing modes may
 * throw on any access.
 */

import { genId } from '../../../shared/ids';

function safeGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Storage unavailable; identity simply will not persist.
  }
}

const CLIENT_ID_KEY = 'syncboard.clientId';
const NAME_KEY = 'syncboard.name';
const RECENT_KEY = 'syncboard.recentBoards';

export function getClientId(): string {
  const existing = safeGet(sessionStorage, CLIENT_ID_KEY);
  if (existing) return existing;
  const id = genId(12);
  safeSet(sessionStorage, CLIENT_ID_KEY, id);
  return id;
}

export function getName(): string {
  const existing = safeGet(localStorage, NAME_KEY);
  if (existing && existing.trim().length > 0) return existing;
  const name = `Guest ${genId(4)}`;
  safeSet(localStorage, NAME_KEY, name);
  return name;
}

export function saveName(name: string): void {
  safeSet(localStorage, NAME_KEY, name);
}

export interface RecentBoard {
  id: string;
  openedAt: number;
}

export function recentBoards(): RecentBoard[] {
  const raw = safeGet(localStorage, RECENT_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is RecentBoard =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as RecentBoard).id === 'string' &&
          typeof (entry as RecentBoard).openedAt === 'number',
      )
      .slice(0, 8);
  } catch {
    return [];
  }
}

export function rememberBoard(id: string): void {
  const rest = recentBoards().filter((b) => b.id !== id);
  const next = [{ id, openedAt: Date.now() }, ...rest].slice(0, 8);
  safeSet(localStorage, RECENT_KEY, JSON.stringify(next));
}

export function forgetBoard(id: string): void {
  const next = recentBoards().filter((b) => b.id !== id);
  safeSet(localStorage, RECENT_KEY, JSON.stringify(next));
}
