// Development-only help for the first-hour mistake: bars that are left out, or stamped in the wrong unit, draw an empty
// chart or January 1970 with nothing said. Nothing here changes what is drawn.

declare const process: { env: { NODE_ENV?: string } } | undefined;

const PRICES = ['open', 'high', 'low', 'close'] as const;
const SECONDS_FROM = 1e9; // 2001 as Unix seconds
const SECONDS_TO = 1e11; // 1973 as Unix milliseconds: a market bar stamped in ms is never below this

/** Why one bar cannot be drawn, in words; null when it can. Mirrors the chart's own check. */
function whyLeftOut(bar: unknown): string | null {
  if (bar === null || typeof bar !== 'object') return 'a bar that is not an object';
  const b = bar as Record<string, unknown>;
  if (typeof b.timestamp === 'string') return 'a timestamp that is text (an ISO date or digits): a bar timestamp is a number in Unix ms';
  if (typeof b.timestamp !== 'number' || !Number.isFinite(b.timestamp) || Math.abs(b.timestamp) > 8.64e15) return 'a timestamp that is missing or not a number in Unix ms';
  for (const field of PRICES) {
    const v = b[field];
    if (typeof v === 'string') return `${field} given as a string: prices are numbers`;
    if (typeof v !== 'number' || !Number.isFinite(v)) return `${field} missing or not a finite number`;
  }
  return null;
}

/**
 * The warning for a list of bars, or null when there is nothing to say. `usable` is how many bars the chart kept.
 * An empty or absent list says nothing: that is a chart still waiting for its data.
 */
export function checkBars(bars: unknown, usable: number): string | null {
  if (!Array.isArray(bars) || bars.length === 0) return null;
  if (usable < bars.length) {
    const counts = new Map<string, number>();
    for (const bar of bars) {
      const why = whyLeftOut(bar);
      if (why !== null) counts.set(why, (counts.get(why) ?? 0) + 1);
    }
    const reasons = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([why, n]) => `${n} with ${why}`);
    return `Matchstick Primitives: ${bars.length - usable} of ${bars.length} bars left out of the chart: ${reasons.join('; ')}.`;
  }
  // Every bar is drawable; look at the first and last for a unit mistake (two reads, so a long series pays nothing).
  const first = bars[0]?.timestamp;
  const last = bars[bars.length - 1]?.timestamp;
  const seconds = (t: unknown) => typeof t === 'number' && Math.abs(t) >= SECONDS_FROM && Math.abs(t) < SECONDS_TO;
  if (seconds(first) && seconds(last)) {
    return `Matchstick Primitives: bar timestamps look like Unix seconds (${first}), so the chart draws January 1970. Bar timestamps are Unix milliseconds: multiply by 1000.`;
  }
  return null;
}

const said = new Set<string>();

function inDevelopment(): boolean {
  try {
    return process!.env.NODE_ENV !== 'production'; // a bundler replaces this expression; Node reads it
  } catch {
    return true; // a browser with no bundler has no `process`
  }
}

/** console.warn, once per message, and never in a production build. */
export function devWarn(message: string): void {
  if (!inDevelopment() || said.has(message)) return;
  said.add(message);
  console.warn(message);
}
