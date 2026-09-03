/**
 * Convergence tests: a miniature authoritative server plus optimistic clients
 * built on the same shared applyOp the real client and server use. Broadcasts
 * are delivered through per-client inboxes so message interleavings can be
 * controlled and randomized.
 */

import { describe, expect, it } from 'vitest';
import type { AppliedOp, BoardState, Op, RejectReason } from '../../shared/types.js';
import { applyOp, cardsInColumn, sortedColumns } from '../../shared/ops.js';

function initialBoard(): BoardState {
  return {
    id: 'convboard',
    version: 0,
    columns: [
      { id: 'colA', title: 'To do', order: 0 },
      { id: 'colB', title: 'Done', order: 1 },
    ],
    cards: [
      { id: 'cardX', columnId: 'colA', title: 'X', description: '', order: 0 },
      { id: 'cardY', columnId: 'colA', title: 'Y', description: '', order: 1 },
      { id: 'cardZ', columnId: 'colB', title: 'Z', description: '', order: 0 },
    ],
  };
}

class MiniServer {
  state: BoardState;
  applied = 0;
  rejected = 0;

  constructor(initial: BoardState) {
    this.state = structuredClone(initial);
  }

  submit(
    actorId: string,
    opId: string,
    op: Op,
  ): { applied: AppliedOp } | { reject: { opId: string; reason: RejectReason } } {
    const result = applyOp(this.state, op);
    if (!result.ok) {
      this.rejected += 1;
      return { reject: { opId, reason: result.reason } };
    }
    result.state.version = this.state.version + 1;
    this.state = result.state;
    this.applied += 1;
    return { applied: { version: this.state.version, op, actorId, opId } };
  }
}

type Inbound =
  | { kind: 'ops'; applied: AppliedOp }
  | { kind: 'reject'; opId: string };

class SimClient {
  confirmed: BoardState;
  pending: { opId: string; op: Op }[] = [];
  inbox: Inbound[] = [];
  private seq = 0;

  constructor(
    readonly id: string,
    initial: BoardState,
  ) {
    this.confirmed = structuredClone(initial);
  }

  /** Optimistically apply an intent and submit it to the server. */
  propose(op: Op, server: MiniServer, everyone: SimClient[]): void {
    const opId = `${this.id}op${this.seq++}`;
    this.pending.push({ opId, op });
    const outcome = server.submit(this.id, opId, op);
    if ('applied' in outcome) {
      for (const client of everyone) {
        client.inbox.push({ kind: 'ops', applied: outcome.applied });
      }
    } else {
      this.inbox.push({ kind: 'reject', opId: outcome.reject.opId });
    }
  }

  consumeOne(): boolean {
    const msg = this.inbox.shift();
    if (!msg) return false;
    if (msg.kind === 'ops') {
      const result = applyOp(this.confirmed, msg.applied.op);
      if (!result.ok) {
        throw new Error(`confirmed state diverged for ${this.id}: ${result.reason}`);
      }
      result.state.version = msg.applied.version;
      this.confirmed = result.state;
      if (msg.applied.actorId === this.id) {
        this.pending = this.pending.filter((p) => p.opId !== msg.applied.opId);
      }
    } else {
      this.pending = this.pending.filter((p) => p.opId !== msg.opId);
    }
    return true;
  }

  drain(): void {
    while (this.consumeOne()) {
      // keep consuming
    }
  }

  /** Confirmed state plus optimistic pending ops, skipping any that no longer apply. */
  view(): BoardState {
    let state = this.confirmed;
    for (const p of this.pending) {
      const result = applyOp(state, p.op);
      if (result.ok) state = result.state;
    }
    return state;
  }
}

/** Canonical projection so comparisons ignore array insertion order. */
function canonical(state: BoardState) {
  return {
    version: state.version,
    columns: sortedColumns(state).map((col) => ({
      id: col.id,
      title: col.title,
      cards: cardsInColumn(state, col.id).map((c) => [c.id, c.title, c.description]),
    })),
  };
}

function setup() {
  const initial = initialBoard();
  const server = new MiniServer(initial);
  const alice = new SimClient('alice', initial);
  const bob = new SimClient('bob', initial);
  const everyone = [alice, bob];
  return { server, alice, bob, everyone };
}

describe('two-client convergence', () => {
  it('converges when both clients edit concurrently without conflicts', () => {
    const { server, alice, bob, everyone } = setup();

    alice.propose(
      { type: 'createCard', cardId: 'cardN1', columnId: 'colA', title: 'From alice' },
      server,
      everyone,
    );
    bob.propose(
      { type: 'moveCard', cardId: 'cardZ', toColumnId: 'colA', toIndex: 0 },
      server,
      everyone,
    );
    // Neither client has consumed broadcasts yet; optimistic views differ.
    expect(alice.view().version).toBe(0);

    alice.drain();
    bob.drain();

    expect(alice.pending).toHaveLength(0);
    expect(bob.pending).toHaveLength(0);
    expect(canonical(alice.view())).toEqual(canonical(server.state));
    expect(canonical(bob.view())).toEqual(canonical(server.state));
    expect(server.state.version).toBe(2);
  });

  it('rolls back an optimistic move of a card another client deleted', () => {
    const { server, alice, bob, everyone } = setup();

    // Bob deletes cardX; the delete reaches the server first.
    bob.propose({ type: 'deleteCard', cardId: 'cardX' }, server, everyone);
    // Alice has not seen the delete and optimistically moves the same card.
    alice.propose(
      { type: 'moveCard', cardId: 'cardX', toColumnId: 'colB', toIndex: 0 },
      server,
      everyone,
    );

    // Alice's optimistic view still shows the move before broadcasts land.
    expect(cardsInColumn(alice.view(), 'colB').map((c) => c.id)).toContain('cardX');

    alice.drain();
    bob.drain();

    expect(server.rejected).toBe(1);
    expect(alice.pending).toHaveLength(0);
    expect(canonical(alice.view())).toEqual(canonical(server.state));
    expect(canonical(bob.view())).toEqual(canonical(server.state));
    expect(server.state.cards.some((c) => c.id === 'cardX')).toBe(false);
    // The rejected op must not have consumed a version.
    expect(server.state.version).toBe(1);
  });

  it('converges when both clients reorder the same column concurrently', () => {
    const { server, alice, bob, everyone } = setup();

    alice.propose(
      { type: 'moveCard', cardId: 'cardX', toColumnId: 'colA', toIndex: 1 },
      server,
      everyone,
    );
    bob.propose(
      { type: 'moveCard', cardId: 'cardY', toColumnId: 'colA', toIndex: 0 },
      server,
      everyone,
    );
    alice.drain();
    bob.drain();

    // Server order wins; both clients agree with it exactly.
    expect(canonical(alice.view())).toEqual(canonical(server.state));
    expect(canonical(bob.view())).toEqual(canonical(server.state));
  });

  it('converges when a column is deleted under a pending card creation', () => {
    const { server, alice, bob, everyone } = setup();

    bob.propose({ type: 'deleteColumn', columnId: 'colA' }, server, everyone);
    alice.propose(
      { type: 'createCard', cardId: 'cardNew', columnId: 'colA', title: 'Too late' },
      server,
      everyone,
    );

    alice.drain();
    bob.drain();

    expect(server.rejected).toBe(1);
    expect(canonical(alice.view())).toEqual(canonical(server.state));
    expect(canonical(bob.view())).toEqual(canonical(server.state));
  });
});

describe('duplicateCard', () => {
  it('copies the card and bumps the version by exactly one', () => {
    const { server, alice, everyone } = setup();
    const before = server.state.version;

    alice.propose(
      { type: 'duplicateCard', cardId: 'cardX', newCardId: 'cardXcopy' },
      server,
      everyone,
    );
    alice.drain();

    expect(server.state.version).toBe(before + 1);
    expect(server.applied).toBe(1);
    const original = server.state.cards.find((c) => c.id === 'cardX');
    const copy = server.state.cards.find((c) => c.id === 'cardXcopy');
    expect(copy?.title).toBe(original?.title);
    expect(copy?.description).toBe(original?.description);
    expect(copy?.columnId).toBe(original?.columnId);
    // The copy sits directly below the original in the same column.
    expect(cardsInColumn(server.state, 'colA').map((c) => c.id)).toEqual([
      'cardX',
      'cardXcopy',
      'cardY',
    ]);
    expect(alice.pending).toHaveLength(0);
    expect(canonical(alice.view())).toEqual(canonical(server.state));
  });

  it('converges when two clients duplicate different cards concurrently', () => {
    const { server, alice, bob, everyone } = setup();

    alice.propose(
      { type: 'duplicateCard', cardId: 'cardX', newCardId: 'cardXdup' },
      server,
      everyone,
    );
    bob.propose(
      { type: 'duplicateCard', cardId: 'cardZ', newCardId: 'cardZdup' },
      server,
      everyone,
    );
    alice.drain();
    bob.drain();

    expect(alice.pending).toHaveLength(0);
    expect(bob.pending).toHaveLength(0);
    expect(canonical(alice.view())).toEqual(canonical(server.state));
    expect(canonical(bob.view())).toEqual(canonical(server.state));
    expect(server.state.version).toBe(2);
  });

  it('rejects duplicating a card another client already deleted', () => {
    const { server, alice, bob, everyone } = setup();

    // Bob deletes cardX; the delete reaches the server first.
    bob.propose({ type: 'deleteCard', cardId: 'cardX' }, server, everyone);
    // Alice has not seen the delete and optimistically duplicates the same card.
    alice.propose(
      { type: 'duplicateCard', cardId: 'cardX', newCardId: 'cardXdup' },
      server,
      everyone,
    );

    alice.drain();
    bob.drain();

    expect(server.rejected).toBe(1);
    expect(alice.pending).toHaveLength(0);
    expect(server.state.cards.some((c) => c.id === 'cardXdup')).toBe(false);
    expect(canonical(alice.view())).toEqual(canonical(server.state));
    expect(canonical(bob.view())).toEqual(canonical(server.state));
  });
});

describe('randomized interleaving fuzz', () => {
  // Deterministic PRNG so failures are reproducible.
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomOp(rand: () => number, view: BoardState, salt: string, step: number): Op | null {
    const columns = sortedColumns(view);
    const cards = view.cards;
    const pick = <T>(items: T[]): T | undefined => items[Math.floor(rand() * items.length)];
    const roll = rand();

    if (roll < 0.3 && columns.length > 0) {
      const column = pick(columns);
      if (!column) return null;
      return {
        type: 'createCard',
        cardId: `card${salt}${step}`,
        columnId: column.id,
        title: `Card ${salt} ${step}`,
      };
    }
    if (roll < 0.6 && cards.length > 0 && columns.length > 0) {
      const card = pick(cards);
      const column = pick(columns);
      if (!card || !column) return null;
      return {
        type: 'moveCard',
        cardId: card.id,
        toColumnId: column.id,
        toIndex: Math.floor(rand() * 6),
      };
    }
    if (roll < 0.72 && cards.length > 0) {
      const card = pick(cards);
      if (!card) return null;
      return { type: 'deleteCard', cardId: card.id };
    }
    if (roll < 0.82 && cards.length > 0) {
      const card = pick(cards);
      if (!card) return null;
      return { type: 'editCard', cardId: card.id, title: `Edited ${salt} ${step}` };
    }
    if (roll < 0.88 && columns.length < 8) {
      return {
        type: 'createColumn',
        columnId: `col${salt}${step}`,
        title: `Column ${salt} ${step}`,
      };
    }
    if (roll < 0.94 && columns.length > 1) {
      const column = pick(columns);
      if (!column) return null;
      return { type: 'reorderColumn', columnId: column.id, toIndex: Math.floor(rand() * 6) };
    }
    if (columns.length > 1) {
      const column = pick(columns);
      if (!column) return null;
      return { type: 'deleteColumn', columnId: column.id };
    }
    return null;
  }

  it('two clients with randomly interleaved ops and deliveries converge', () => {
    for (const seed of [1, 7, 42, 1337]) {
      const rand = mulberry32(seed);
      const { server, alice, bob, everyone } = setup();

      for (let step = 0; step < 300; step++) {
        const client = rand() < 0.5 ? alice : bob;
        const action = rand();
        if (action < 0.55) {
          const op = randomOp(rand, client.view(), client.id, step);
          if (op) client.propose(op, server, everyone);
        } else {
          client.consumeOne();
        }
      }

      alice.drain();
      bob.drain();

      expect(alice.pending, `seed ${seed}`).toHaveLength(0);
      expect(bob.pending, `seed ${seed}`).toHaveLength(0);
      expect(canonical(alice.view()), `seed ${seed}`).toEqual(canonical(server.state));
      expect(canonical(bob.view()), `seed ${seed}`).toEqual(canonical(server.state));
      expect(alice.confirmed.version, `seed ${seed}`).toBe(server.state.version);
      expect(server.state.version).toBe(server.applied);
    }
  });
});
