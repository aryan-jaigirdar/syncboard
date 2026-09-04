/**
 * Defensive parsing of client messages. Nothing coming over the wire is
 * trusted; every field is checked before it reaches the room logic.
 */

import type { ClientMessage, Op } from '../../shared/types.js';
import { LIMITS, isCardLabel } from '../../shared/types.js';
import { isValidId } from '../../shared/ids.js';

export type ParseResult =
  | { ok: true; msg: ClientMessage }
  | { ok: false; opId?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asBoundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value.length > maxLength) return null;
  return value;
}

function asIndex(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 0 || value > 100_000) return null;
  return value;
}

function asCoordinate(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(Math.max(0, Math.min(100_000, value)));
}

export function parseOp(value: unknown): Op | null {
  if (!isRecord(value)) return null;

  switch (value['type']) {
    case 'createCard': {
      if (!isValidId(value['cardId']) || !isValidId(value['columnId'])) return null;
      const title = asBoundedString(value['title'], LIMITS.titleLength);
      if (title === null) return null;
      const op: Op = { type: 'createCard', cardId: value['cardId'], columnId: value['columnId'], title };
      if (value['description'] !== undefined) {
        const description = asBoundedString(value['description'], LIMITS.descriptionLength);
        if (description === null) return null;
        op.description = description;
      }
      if (value['index'] !== undefined) {
        const index = asIndex(value['index']);
        if (index === null) return null;
        op.index = index;
      }
      return op;
    }
    case 'moveCard': {
      if (!isValidId(value['cardId']) || !isValidId(value['toColumnId'])) return null;
      const toIndex = asIndex(value['toIndex']);
      if (toIndex === null) return null;
      return { type: 'moveCard', cardId: value['cardId'], toColumnId: value['toColumnId'], toIndex };
    }
    case 'editCard': {
      if (!isValidId(value['cardId'])) return null;
      const op: Op = { type: 'editCard', cardId: value['cardId'] };
      if (value['title'] !== undefined) {
        const title = asBoundedString(value['title'], LIMITS.titleLength);
        if (title === null) return null;
        op.title = title;
      }
      if (value['description'] !== undefined) {
        const description = asBoundedString(value['description'], LIMITS.descriptionLength);
        if (description === null) return null;
        op.description = description;
      }
      if (op.title === undefined && op.description === undefined) return null;
      return op;
    }
    case 'deleteCard': {
      if (!isValidId(value['cardId'])) return null;
      return { type: 'deleteCard', cardId: value['cardId'] };
    }
    case 'duplicateCard': {
      if (!isValidId(value['cardId']) || !isValidId(value['newCardId'])) return null;
      return { type: 'duplicateCard', cardId: value['cardId'], newCardId: value['newCardId'] };
    }
    case 'setCardLabel': {
      if (!isValidId(value['cardId'])) return null;
      if (!isCardLabel(value['label'])) return null;
      return { type: 'setCardLabel', cardId: value['cardId'], label: value['label'] };
    }
    case 'createColumn': {
      if (!isValidId(value['columnId'])) return null;
      const title = asBoundedString(value['title'], LIMITS.titleLength);
      if (title === null) return null;
      const op: Op = { type: 'createColumn', columnId: value['columnId'], title };
      if (value['index'] !== undefined) {
        const index = asIndex(value['index']);
        if (index === null) return null;
        op.index = index;
      }
      return op;
    }
    case 'renameColumn': {
      if (!isValidId(value['columnId'])) return null;
      const title = asBoundedString(value['title'], LIMITS.titleLength);
      if (title === null) return null;
      return { type: 'renameColumn', columnId: value['columnId'], title };
    }
    case 'deleteColumn': {
      if (!isValidId(value['columnId'])) return null;
      return { type: 'deleteColumn', columnId: value['columnId'] };
    }
    case 'reorderColumn': {
      if (!isValidId(value['columnId'])) return null;
      const toIndex = asIndex(value['toIndex']);
      if (toIndex === null) return null;
      return { type: 'reorderColumn', columnId: value['columnId'], toIndex };
    }
    default:
      return null;
  }
}

function sanitizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().slice(0, LIMITS.nameLength);
  return name.length > 0 ? name : null;
}

export function parseClientMessage(raw: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (!isRecord(value)) return { ok: false };

  switch (value['type']) {
    case 'join': {
      if (!isValidId(value['boardId']) || !isValidId(value['clientId'])) return { ok: false };
      const name = sanitizeName(value['name']);
      if (name === null) return { ok: false };
      const msg: ClientMessage = {
        type: 'join',
        boardId: value['boardId'],
        clientId: value['clientId'],
        name,
      };
      if (value['sinceVersion'] !== undefined) {
        const since = value['sinceVersion'];
        if (typeof since !== 'number' || !Number.isInteger(since) || since < 0) {
          return { ok: false };
        }
        msg.sinceVersion = since;
      }
      return { ok: true, msg };
    }
    case 'op': {
      const opId = isValidId(value['opId']) ? value['opId'] : undefined;
      const baseVersion = value['baseVersion'];
      if (
        opId === undefined ||
        typeof baseVersion !== 'number' ||
        !Number.isInteger(baseVersion) ||
        baseVersion < 0
      ) {
        return { ok: false, ...(opId !== undefined ? { opId } : {}) };
      }
      const op = parseOp(value['op']);
      if (!op) return { ok: false, opId };
      return { ok: true, msg: { type: 'op', opId, baseVersion, op } };
    }
    case 'cursor': {
      const x = asCoordinate(value['x']);
      const y = asCoordinate(value['y']);
      if (x === null || y === null || typeof value['visible'] !== 'boolean') {
        return { ok: false };
      }
      return { ok: true, msg: { type: 'cursor', x, y, visible: value['visible'] } };
    }
    case 'setName': {
      const name = sanitizeName(value['name']);
      if (name === null) return { ok: false };
      return { ok: true, msg: { type: 'setName', name } };
    }
    default:
      return { ok: false };
  }
}
