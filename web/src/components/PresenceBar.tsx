import { useState } from 'react';
import type { Peer } from '../../../shared/types';
import { LIMITS } from '../../../shared/types';

interface PresenceBarProps {
  peers: Peer[];
  self: Peer;
  onRename(name: string): void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}

const MAX_AVATARS = 5;

export function PresenceBar({ peers, self, onRename }: PresenceBarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(self.name);

  // One avatar per client id, never counting this tab twice.
  const others = peers.filter(
    (peer, i) =>
      peer.clientId !== self.clientId &&
      peers.findIndex((p) => p.clientId === peer.clientId) === i,
  );
  const shown = others.slice(0, MAX_AVATARS);
  const overflow = others.length - shown.length;

  function commit() {
    setEditing(false);
    onRename(draft);
  }

  return (
    <div className="presence">
      <div className="avatars">
        {shown.map((peer) => (
          <span
            key={peer.clientId}
            className="avatar"
            style={{ backgroundColor: peer.color }}
            title={peer.name}
          >
            {initials(peer.name)}
          </span>
        ))}
        {overflow > 0 && <span className="avatar avatar-overflow">+{overflow}</span>}
        <span
          className="avatar avatar-self"
          style={{ backgroundColor: self.color }}
          title={`${self.name} (you)`}
        >
          {initials(self.name)}
        </span>
      </div>
      {editing ? (
        <input
          className="name-input"
          value={draft}
          maxLength={LIMITS.nameLength}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(self.name);
              setEditing(false);
            }
          }}
          aria-label="Your display name"
        />
      ) : (
        <button
          className="name-button"
          onClick={() => {
            setDraft(self.name);
            setEditing(true);
          }}
          title="Change your display name"
        >
          {self.name}
        </button>
      )}
    </div>
  );
}
