import { createContext } from 'react';
import type { CandleBar, PriceSpan } from './core/chart-scale.js';
import type { MoveDestination, PanelLayout } from './core/panels.js';
import type { ResolvedSeries, SeriesPoint } from './core/series.js';

/**
 * One series a host puts on the chart besides its bars. Give it `points` (a time and a value or a reason for none, see
 * `core/series`); it is placed on the bars by time. `values` (one number per bar, by position) still works for now and is
 * removed in 0.0.7.
 */
export interface PanelSeriesData {
  /** The selection id. Unique on the chart. */
  id: string;
  /** What the series is called: button names, the list and the live-region text. */
  label: string;
  /** The series on its own clock. Placed on the bars by time (`align` on `Panels.Root`; exact by default). */
  points?: ReadonlyArray<SeriesPoint>;
  /**
   * @deprecated One value per bar by position, null for none. A length that differs from the bars is shown as a problem
   * in `Panels.List`. Removed in 0.0.7; use `points` (for a study, `pointsFromValues` from the core makes them).
   */
  values?: ReadonlyArray<number | null>;
  /** A fixed vertical range `[min, max]` for the band the series is in (an oscillator bounded 0 to 100). Ignored in `main`. */
  range?: readonly [number, number];
  /** Horizontal reference lines in the band, for example `[30, 70]`. Ignored in `main`. */
  levels?: readonly number[];
  /** `line` (default), or `histogram`: bars from zero, for a signed series. */
  style?: 'line' | 'histogram';
}

/**
 * The context behind Panels, in a module of its own so Chart can read the layout without importing the parts (which
 * import Chart).
 */
export interface PanelsContextValue {
  series: readonly PanelSeriesData[];
  layout: PanelLayout;
  move: (seriesId: string, destination: MoveDestination) => void;
  /** Prices of the series sitting in `main`, so the main scale keeps them in view. */
  mainInclude: (visible: { first: number; last: number }, bars: readonly CandleBar[]) => readonly PriceSpan[];
  /** A series on these bars: the value at each bar and the problems with the input. Cached per bars array and series. */
  resolve: (item: PanelSeriesData, bars: readonly CandleBar[]) => ResolvedSeries;
  /** Problems that belong to the set, not one series (an id used twice). */
  problems: readonly string[];
}
export const PanelsContext = createContext<PanelsContextValue | null>(null);
