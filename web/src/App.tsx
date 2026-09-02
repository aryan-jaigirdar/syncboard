import { useSyncExternalStore } from 'react';
import { Landing } from './pages/Landing';
import { BoardPage } from './pages/BoardPage';

/** Minimal history-API router; the app has exactly two routes. */

export function navigate(to: string): void {
  window.history.pushState({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function subscribeToPath(callback: () => void): () => void {
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
}

function usePath(): string {
  return useSyncExternalStore(subscribeToPath, () => window.location.pathname);
}

const BOARD_ROUTE = /^\/b\/([A-Za-z0-9]{4,32})$/;

export function App() {
  const path = usePath();
  const match = BOARD_ROUTE.exec(path);
  if (match && match[1]) {
    return <BoardPage key={match[1]} boardId={match[1]} />;
  }
  return <Landing />;
}
