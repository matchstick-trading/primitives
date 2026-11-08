import { createContext, type MutableRefObject } from 'react';
import type { ChartSelection } from './core/selection.js';

/**
 * The contexts behind Selection and Series, in a module of their own so Chart, Drawings and Studies can read them
 * without importing the parts (which import Chart).
 */

/** What Drawings.Layer tells the Selection.Layer so a press on a drawing, or while a tool is in use, is not read as a tap on clear chart. */
export interface SelectionGuard {
  /** True when a press here belongs to a drawing or to a tool in use. */
  owns: (clientX: number, clientY: number, pointerType: string) => boolean;
  /** True while a tool is armed or a drawing is half placed: Escape then cancels that first. */
  busy: () => boolean;
}

export interface SelectionContextValue {
  /** The selection now. */
  selection: ChartSelection;
  /** Change the selection. Setting what is already selected does nothing, so two parts agreeing on a tap report once. */
  select: (next: ChartSelection) => void;
  /** The selection as of the last change, even before the next render. */
  current: () => ChartSelection;
  /** The series a Series.Root mounted, or null. A tap on clear chart selects it. */
  series: { id: string; label: string } | null;
  registerSeries: (series: { id: string; label: string }) => () => void;
  /** A name for the live region; the id is used when none is set. Returns the cleanup. */
  setName: (kind: 'drawing' | 'series' | 'study', id: string, name: string) => () => void;
  guard: MutableRefObject<SelectionGuard | null>;
}
export const SelectionContext = createContext<SelectionContextValue | null>(null);

export interface SeriesContextValue {
  id: string;
  label: string;
  selected: boolean;
}
export const SeriesContext = createContext<SeriesContextValue | null>(null);
