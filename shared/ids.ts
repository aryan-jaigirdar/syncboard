/**
 * Random short ids, generated with the Web Crypto API which is available as a
 * global in both Node 20 and every modern browser.
 *
 * The alphabet omits easily confused characters (0, O, 1, l, I). The slight
 * modulo bias is irrelevant here; these ids are identifiers, not secrets.
 */

const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function genId(length = 12): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) {
    out += ALPHABET[byte % ALPHABET.length];
  }
  return out;
}

export const BOARD_ID_LENGTH = 8;

export function genBoardId(): string {
  return genId(BOARD_ID_LENGTH);
}

const ID_PATTERN = /^[A-Za-z0-9]{4,32}$/;

export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}
