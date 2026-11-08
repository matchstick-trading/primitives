/**
 * The rules of the evidence receipt as plain functions. Digests and sizes are strings and are
 * printed as given.
 */
export interface ReceiptData {
  dataset: string;
  symbol: string;
  synthetic: boolean;
  a: string;
  b: string;
  eventsBetween: number;
  sourceDigest: string;
  stateDigestA: string;
  stateDigestB: string;
  resultHash: string;
  engineVersion: string;
  levelsDiffer: number;
  /** Whether replaying from the start gave the same two states and the same result hash. */
  recomputeMatch: boolean;
  /** The line that must travel with a copy when the data is not synthetic. */
  shareNote?: string;
}

export type ReceiptVerdict = 'match' | 'mismatch';
export const receiptVerdict = (receipt: Pick<ReceiptData, 'recomputeMatch'>): ReceiptVerdict => (receipt.recomputeMatch ? 'match' : 'mismatch');

export type ReceiptHashOf = 'source' | 'a' | 'b' | 'result';
export function receiptHash(receipt: ReceiptData, of: ReceiptHashOf): string {
  return of === 'source' ? receipt.sourceDigest : of === 'a' ? receipt.stateDigestA : of === 'b' ? receipt.stateDigestB : receipt.resultHash;
}

interface KeyLike { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }

/**
 * Enter or `y` copies the result hash. Enter on a button or link is that control's own and is left alone; `y` is
 * ignored while typing in a field.
 */
export function resolveReceiptKey(event: KeyLike, target: { tagName: string; isContentEditable?: boolean }): 'copy-hash' | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) return null;
  if (event.key === 'y') return 'copy-hash';
  if (event.key === 'Enter' && tag !== 'button' && tag !== 'a') return 'copy-hash';
  return null;
}
