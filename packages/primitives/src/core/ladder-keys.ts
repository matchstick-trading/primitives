/**
 * Ladder keyboard contract. Read-only: no key places or changes an order.
 *
 * | Key           | Action                                                         |
 * |---------------|----------------------------------------------------------------|
 * | ArrowDown     | focus the next row down                                        |
 * | ArrowUp       | focus the next row up                                          |
 * | Home          | focus the best bid                                             |
 * | End           | focus the best ask                                             |
 * | Enter / Space | seek to when this level last changed (when the host supplies it) |
 *
 * One row is the tab stop (roving tabindex), so Tab leaves the ladder in one press. Home and End are also the
 * global transport "start" and "end" keys; inside the ladder they mean best bid and best ask, and the ladder
 * stops them there.
 */
export type LadderKeyAction = 'next' | 'previous' | 'best-bid' | 'best-ask';

/** The fields of a keyboard event the contract reads; a DOM or React KeyboardEvent fits. */
export interface LadderKeyInput { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }

export function resolveLadderKey(event: LadderKeyInput): LadderKeyAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  switch (event.key) {
    case 'ArrowDown':
      return 'next';
    case 'ArrowUp':
      return 'previous';
    case 'Home':
      return 'best-bid';
    case 'End':
      return 'best-ask';
    default:
      return null;
  }
}

/** Marks a row for the contract. `best` rows are what Home and End jump to. */
export const LADDER_ROW_ATTRIBUTE = 'data-ladder-row';

/**
 * On screen: it has a box and no closed `<details>` above it. Chromium still reports boxes for the contents of a
 * closed disclosure, so the box test alone is not enough.
 */
export function isRowShown(row: HTMLElement): boolean {
  for (let el: HTMLElement | null = row.parentElement; el; el = el.parentElement) {
    if (el instanceof HTMLDetailsElement && !el.open) return false;
  }
  return row.getClientRects().length > 0;
}

/** The row to focus, or null when the key does nothing here. `rows` are in screen order, top to bottom. */
export function nextLadderRow(rows: readonly HTMLElement[], current: HTMLElement | null, action: LadderKeyAction): HTMLElement | null {
  if (!rows.length) return null;
  if (action === 'best-bid') return rows.find((row) => row.dataset.best === 'bid') ?? null;
  if (action === 'best-ask') return rows.find((row) => row.dataset.best === 'ask') ?? null;
  const at = current ? rows.indexOf(current) : -1;
  if (at < 0) return rows[0] ?? null;
  const to = action === 'next' ? at + 1 : at - 1;
  return rows[to] ?? null; // stops at the ends; never wraps
}

