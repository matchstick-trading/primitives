/**
 * The data-attribute vocabulary every primitive speaks. State lives in `data-*`
 * attributes, never in class names, so a host styles with `[data-side="bid"]` and the tokens in
 * `tokens.css`. Values are the whole vocabulary: a part never invents another.
 */
export type Side = 'bid' | 'ask';
/** Movement since the previous step. Not the diff status below: `data-change` is movement, `data-diff` is difference. */
export type Change = 'up' | 'down' | 'flat';
/** How a level differs between two books; the report's `change` field, as an attribute. */
export type DiffStatus = 'added' | 'removed' | 'modified';
export type Quality = 'ok' | 'gap' | 'stale' | 'truncated';
export type CursorMark = 'a' | 'b';

export interface PrimitiveState {
  side?: Side;
  change?: Change;
  diff?: DiffStatus;
  quality?: Quality;
  cursor?: CursorMark;
  /** True when the value comes from a synthetic session. */
  synthetic?: boolean;
}

export type PrimitiveAttributes = {
  /** Scopes tokens.css to primitive markup. */
  'data-mt': '';
  'data-side'?: Side;
  'data-change'?: Change;
  'data-diff'?: DiffStatus;
  'data-quality'?: Quality;
  'data-cursor'?: CursorMark;
  'data-synthetic'?: '';
};

/** Spreads onto a DOM element. Unset states emit nothing, so an attribute selector never matches by accident. */
export function primitiveAttributes(state: PrimitiveState): PrimitiveAttributes {
  const out: PrimitiveAttributes = { 'data-mt': '' };
  if (state.side) out['data-side'] = state.side;
  if (state.change) out['data-change'] = state.change;
  if (state.diff) out['data-diff'] = state.diff;
  if (state.quality) out['data-quality'] = state.quality;
  if (state.cursor) out['data-cursor'] = state.cursor;
  if (state.synthetic) out['data-synthetic'] = '';
  return out;
}

/** The width that holds the widest sample without growing, in `ch`: the value for `--mt-numeric-width`. */
export function numericWidthValue(...samples: readonly string[]): string {
  const longest = samples.reduce((n, s) => Math.max(n, s.length), 0);
  return `${longest}ch`;
}
