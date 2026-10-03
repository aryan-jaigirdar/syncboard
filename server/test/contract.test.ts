import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AppliedOp, BoardState } from '../../shared/types.js';
import { applyOp } from '../../shared/ops.js';
import { parseClientMessage } from '../src/protocol.js';

const fixture = JSON.parse(fs.readFileSync(
  new URL('../../shared/fixtures/sync-contract.json', import.meta.url), 'utf8',
)) as { initialState: BoardState; ops: AppliedOp[]; expectedState: BoardState };

describe('portable sync contract', () => {
  it('accepts every wire intent and reaches the shared cross-client result', () => {
    let state = fixture.initialState;
    for (const entry of fixture.ops) {
      const parsed = parseClientMessage(JSON.stringify({
        type: 'op', opId: entry.opId, baseVersion: state.version, op: entry.op,
      }));
      if (!parsed.ok || parsed.msg.type !== 'op') throw new Error(`invalid fixture op ${entry.opId}`);
      const result = applyOp(state, parsed.msg.op);
      if (!result.ok) throw new Error(`fixture rejected ${entry.opId}: ${result.reason}`);
      result.state.version = entry.version;
      state = result.state;
    }
    expect(state).toEqual(fixture.expectedState);
  });
});
