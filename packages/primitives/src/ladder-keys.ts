import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { isRowShown, LADDER_ROW_ATTRIBUTE, nextLadderRow, resolveLadderKey } from './core/ladder-keys.js';

// The pure contract lives in the core (no React); the hook below is the React layer over it.
export { LADDER_ROW_ATTRIBUTE, nextLadderRow, resolveLadderKey, type LadderKeyAction, type LadderKeyInput } from './core/ladder-keys.js';

/**
 * Roving focus for the ladder rows. Spread `containerProps` on the element wrapping every row, give each row `data-ladder-row={id}` and
 * `tabIndex={id === tabStop(ids, bestBidId) ? 0 : -1}`, where `id` is the row's price level (identity is the price, not the index).
 */
export function useLadderKeys() {
  const container = useRef<HTMLElement | null>(null);
  const [active, setActive] = useState<string | null>(null);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (!(event.target instanceof HTMLElement)) return;
    const action = resolveLadderKey(event);
    // A read-only row is a plain div with no activation of its own: Space on it does nothing, and must not scroll the page
    // or reach the transport's play/pause. (A seeking row is a button, which handles Space itself.)
    const row = event.target.closest(`[${LADDER_ROW_ATTRIBUTE}]`);
    if (event.key === ' ' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && row && row.tagName !== 'BUTTON') {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!action) {
      // A modified Home or End has no ladder meaning, but must not reach the global transport jump either.
      if ((event.key === 'Home' || event.key === 'End') && event.target.closest(`[${LADDER_ROW_ATTRIBUTE}]`)) event.stopPropagation();
      return;
    }
    const host = container.current;
    if (!host) return;
    // Rows inside a closed disclosure are in the DOM but not on screen: they are not part of the walk.
    const rows = Array.from(host.querySelectorAll<HTMLElement>(`[${LADDER_ROW_ATTRIBUTE}]`)).filter(isRowShown);
    const current = event.target.closest<HTMLElement>(`[${LADDER_ROW_ATTRIBUTE}]`);
    if (!current) return;
    event.preventDefault();
    event.stopPropagation(); // Home and End must not reach the global transport shortcuts from here
    const target = nextLadderRow(rows, current, action);
    if (!target) return;
    setActive(target.getAttribute(LADDER_ROW_ATTRIBUTE));
    target.focus();
  }, []);

  const onFocus = useCallback((event: React.FocusEvent<HTMLElement>) => {
    const row = event.target.closest<HTMLElement>(`[${LADDER_ROW_ATTRIBUTE}]`);
    if (row) setActive(row.getAttribute(LADDER_ROW_ATTRIBUTE));
  }, []);

  // The row that holds the tab stop can also leave the screen without a toggle: a replay update can push it past the visible
  // levels into a closed disclosure. After each render, hand the stop back if it is no longer shown (it sets state only then).
  useEffect(() => {
    const host = container.current;
    if (!host || active === null) return;
    const stop = Array.from(host.querySelectorAll<HTMLElement>(`[${LADDER_ROW_ATTRIBUTE}]`)).find((r) => r.getAttribute(LADDER_ROW_ATTRIBUTE) === active);
    if (!stop || !isRowShown(stop)) setActive(null);
  });

  // A disclosure that closes hides the row that held the tab stop; `toggle` does not bubble, so listen in the capture phase.
  useEffect(() => {
    const host = container.current;
    if (!host) return;
    const onToggle = () => {
      const stop = host.querySelector<HTMLElement>(`[${LADDER_ROW_ATTRIBUTE}][tabindex="0"]`);
      if (stop && !isRowShown(stop)) setActive(null);
    };
    host.addEventListener('toggle', onToggle, true);
    return () => host.removeEventListener('toggle', onToggle, true);
  }, []);

  return {
    containerProps: {
      ref: (node: HTMLElement | null) => {
        container.current = node;
      },
      onKeyDown,
      onFocus,
    },
    /** The id of the one row that is a tab stop: the focused row while it is still on screen, else `fallback` (the best bid, or the best ask when there are no bids). */
    tabStop: (ids: readonly string[], fallback: string | undefined): string | undefined =>
      active !== null && ids.includes(active) ? active : fallback,
  };
}
