import type { CSSProperties } from 'react';
import { numericWidthValue } from './core/attributes.js';

export * from './core/attributes.js';

/**
 * A column width that holds the widest value without growing: set the result as the element's style and give
 * the cells `data-mt-numeric`. Counts characters of the longest sample (digits, separator, sign), in `ch`.
 */
export function numericWidth(...samples: readonly string[]): CSSProperties {
  return { ['--mt-numeric-width' as string]: numericWidthValue(...samples) } as CSSProperties;
}
