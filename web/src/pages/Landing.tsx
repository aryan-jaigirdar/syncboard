import { useState } from 'react';
import { navigate } from '../App';
import { forgetBoard, recentBoards, rememberBoard } from '../lib/session';
import { XIcon } from '../components/icons';

function relativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

export function Landing() {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState(recentBoards);

  async function createBoard() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/boards', { method: 'POST' });
      if (!res.ok) throw new Error(`server responded ${res.status}`);
      const body = (await res.json()) as { id: string };
      rememberBoard(body.id);
      navigate(`/b/${body.id}`);
    } catch {
      setError('Could not create a board. Is the server running?');
      setCreating(false);
    }
  }

  function removeRecent(id: string) {
    forgetBoard(id);
    setRecent(recentBoards());
  }

  return (
    <div className="landing">
      <main className="landing-hero">
        <div className="wordmark wordmark-large">
          sync<span className="wordmark-accent">board</span>
        </div>
        <p className="landing-tagline">
          A realtime kanban board. Share the link, edit together, watch every
          card move live.
        </p>
        <button
          className="btn btn-primary btn-large"
          onClick={() => void createBoard()}
          disabled={creating}
        >
          {creating ? 'Creating board' : 'New board'}
        </button>
        {error && <p className="landing-error">{error}</p>}

        {recent.length > 0 && (
          <section className="recent">
            <h2 className="recent-heading">Recent boards</h2>
            <ul className="recent-list">
              {recent.map((board) => (
                <li key={board.id} className="recent-item">
                  <a
                    className="recent-link"
                    href={`/b/${board.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/b/${board.id}`);
                    }}
                  >
                    <span className="recent-id">{board.id}</span>
                    <span className="recent-time">{relativeTime(board.openedAt)}</span>
                  </a>
                  <button
                    className="icon-btn"
                    aria-label={`Remove ${board.id} from recent boards`}
                    onClick={() => removeRecent(board.id)}
                  >
                    <XIcon size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <footer className="landing-footer">
        Boards are open to anyone with the link. No accounts, no setup.
      </footer>
    </div>
  );
}
