/**
 * The geometry and keys of the depth profile as plain functions. Prices and sizes arrive and stay
 * exact decimal strings. A number is made from one only to place a point on the plot, and never shown.
 */

export interface DepthLevel {
  side: 'bid' | 'ask';
  /** Exact decimal string, as recorded. */
  price: string;
  /** Cumulative size from the best price out to this level, as an exact decimal string. */
  cumulative: string;
}

/** The id of a level, the same `side:price` the ladder rows use. */
export const depthLevelId = (level: Pick<DepthLevel, 'side' | 'price'>): string => `${level.side}:${level.price}`;

export const DEPTH_WIDTH = 600;
export const DEPTH_HEIGHT = 180;

export interface DepthGeometry {
  /** Bids from the lowest price up to the best bid, then asks from the best ask up: left to right on the plot. */
  ordered: DepthLevel[];
  x: (price: string) => number;
  y: (cumulative: string) => number;
  /** SVG polygon points for each side; empty when the side has no levels. */
  bidPoints: string;
  askPoints: string;
}

/**
 * `levels` come best price first on each side (bids descending, asks ascending), as the book's depth does. The scale
 * runs from the lowest to the highest price present and from 0 to the largest cumulative size (at least 1).
 */
export function depthGeometry(levels: readonly DepthLevel[]): DepthGeometry {
  const bids = levels.filter((l) => l.side === 'bid');
  const asks = levels.filter((l) => l.side === 'ask');
  const ordered = [...bids].reverse().concat(asks);
  let minPrice = Infinity;
  let maxPrice = -Infinity;
  let maxSize = 1;
  for (const level of ordered) {
    const price = Number(level.price);
    if (price < minPrice) minPrice = price;
    if (price > maxPrice) maxPrice = price;
    maxSize = Math.max(maxSize, Number(level.cumulative));
  }
  const x = (price: string) => (maxPrice === minPrice ? DEPTH_WIDTH / 2 : ((Number(price) - minPrice) / (maxPrice - minPrice)) * DEPTH_WIDTH);
  const y = (cumulative: string) => DEPTH_HEIGHT - (Number(cumulative) / maxSize) * (DEPTH_HEIGHT - 12);
  const polygon = (side: readonly DepthLevel[]) => {
    if (side.length === 0) return '';
    const line = side.map((l) => `${x(l.price)},${y(l.cumulative)}`).join(' ');
    return `${x(side[0].price)},${DEPTH_HEIGHT} ${line} ${x(side[side.length - 1].price)},${DEPTH_HEIGHT}`;
  };
  return { ordered, x, y, bidPoints: polygon([...bids].reverse()), askPoints: polygon(asks) };
}

export type DepthKeyAction = 'previous' | 'next' | 'first' | 'last' | 'clear';

export function resolveDepthKey(event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): DepthKeyAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  switch (event.key) {
    case 'ArrowLeft': return 'previous';
    case 'ArrowRight': return 'next';
    case 'Home': return 'first';
    case 'End': return 'last';
    case 'Escape': return 'clear';
    default: return null;
  }
}

/**
 * The index the crosshair moves to, or null for none. From no crosshair the first move lands on the best bid, the
 * level next to the spread, whichever way the key points. It stops at the ends and never wraps.
 */
export function nextDepthIndex(ordered: readonly DepthLevel[], current: number | null, action: DepthKeyAction): number | null {
  if (ordered.length === 0 || action === 'clear') return null;
  if (action === 'first') return 0;
  if (action === 'last') return ordered.length - 1;
  if (current === null) {
    const bestBid = ordered.map((l) => l.side).lastIndexOf('bid');
    return bestBid >= 0 ? bestBid : 0;
  }
  return Math.min(ordered.length - 1, Math.max(0, current + (action === 'next' ? 1 : -1)));
}
