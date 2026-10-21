// A teaching example of one way to rank symbol-search results. Plain TypeScript, no dependencies.
// It is deliberately small: no typo tolerance, so "acmr" finds nothing instead of guessing.

export interface Instrument {
  symbol: string;
  name: string;
  aliases?: string[];
}

// Lower is better. A query that fits none of these is not a match.
const EXACT_SYMBOL = 0;
const SYMBOL_PREFIX = 1;
const EXACT_ALIAS = 2;
const NAME_WORD_PREFIX = 3;

function tier(item: Instrument, words: string[]): number | null {
  const query = words.join(' ');
  const symbol = item.symbol.toLowerCase();
  if (symbol === query) return EXACT_SYMBOL;
  if (symbol.startsWith(query)) return SYMBOL_PREFIX;
  if (item.aliases?.some((a) => a.toLowerCase() === query)) return EXACT_ALIAS;
  // Every query word must start some word of the name: "north rail" finds "North Ridge Rail".
  const nameWords = item.name.toLowerCase().split(/\s+/);
  if (words.every((w) => nameWords.some((n) => n.startsWith(w)))) return NAME_WORD_PREFIX;
  return null;
}

export function rank(items: Instrument[], query: string, limit = 8): Instrument[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return items
    .map((item) => ({ item, tier: tier(item, words) }))
    .filter((r): r is { item: Instrument; tier: number } => r.tier !== null)
    // Ties: better tier first, then the shorter symbol, then A to Z.
    .sort((a, b) =>
      a.tier - b.tier ||
      a.item.symbol.length - b.item.symbol.length ||
      a.item.symbol.localeCompare(b.item.symbol))
    .slice(0, limit)
    .map((r) => r.item);
}
