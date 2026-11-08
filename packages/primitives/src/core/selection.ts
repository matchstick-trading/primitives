// One selection for a chart: a drawing, the bar series or a study, never more than one. The rules are plain functions
// so any framework layer (and a test) can use them.

/** What is selected on a chart, or null for nothing. */
export type ChartSelection = { kind: 'drawing' | 'series' | 'study'; id: string } | null;

/** True when two selections point at the same thing. */
export function sameSelection(a: ChartSelection, b: ChartSelection): boolean {
  return a === b || (a !== null && b !== null && a.kind === b.kind && a.id === b.id);
}

/**
 * A tap on clear chart (no drawing, no study under it). With something selected, it only puts the selection away. With
 * nothing selected it selects the series when one is mounted (`seriesId`), and otherwise changes nothing. Returns the
 * same value when nothing changes.
 */
export function selectionAfterClearTap(selection: ChartSelection, seriesId: string | null): ChartSelection {
  if (selection !== null) return null;
  return seriesId !== null ? { kind: 'series', id: seriesId } : selection;
}

/** A tap on something selectable (a study line) selects it, whatever was selected before. */
export function selectionAfterTap(selection: ChartSelection, hit: ChartSelection, seriesId: string | null): ChartSelection {
  if (hit === null) return selectionAfterClearTap(selection, seriesId);
  return sameSelection(selection, hit) ? selection : hit;
}

/** Escape clears whatever is selected. */
export function selectionAfterEscape(selection: ChartSelection): ChartSelection {
  return selection === null ? selection : null;
}

/** The names a selection can be described with, per kind and id. A missing name falls back to the id. */
export type SelectionNames = { [K in 'drawing' | 'series' | 'study']?: Readonly<Record<string, string>> };

/** The words for a live region: what is selected now, or that nothing is. */
export function describeSelection(selection: ChartSelection, names: SelectionNames = {}): string {
  if (selection === null) return 'Selection cleared.';
  const name = names[selection.kind]?.[selection.id] ?? selection.id;
  return `Selected ${selection.kind}: ${name}.`;
}
