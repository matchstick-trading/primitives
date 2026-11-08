// Panels: a chart is one or more vertical bands, each with its own price scale, sharing one time axis. The bars (and the
// volume under them) stay in the first band, "main". Other series are placed in a band by id, and move between bands by
// relative destinations ("up", "down", "new panel above or below"), which is the single-pointer path WCAG 2.2 (2.5.7)
// asks of any drag. The rules are plain functions so any framework layer, and a test, can use them.

/** The id of the first band. It always exists, is always first, and holds the chart's own bars and volume. */
export const MAIN_PANEL = 'main';

export interface PanelSpec {
  id: string;
  /** What the band is called in lists and live-region text. */
  label: string;
  /** Share of the height. Default 1 for a panel and 3 for main. */
  weight?: number;
}

export interface PanelLayout {
  /** The bands from top to bottom. The first is always `main`. */
  panels: readonly PanelSpec[];
  /** Series id to panel id. A series with no entry, or a panel that is gone, is in `main`. */
  placement: Readonly<Record<string, string>>;
}

export interface PanelBand {
  id: string;
  /** Top edge, from the top of the plot. */
  top: number;
  height: number;
}

/** Height kept under the bands for the time labels: the same as the chart frame's default `axisBottom`. */
export const AXIS_BOTTOM = 18;

const MIN_BAND = 40;
const MAIN_WEIGHT = 3;

const weightOf = (panel: PanelSpec) => (Number.isFinite(panel.weight) && (panel.weight as number) > 0 ? (panel.weight as number) : panel.id === MAIN_PANEL ? MAIN_WEIGHT : 1);

/** A layout with only `main` (and the given bands below it), `main` forced to the front. */
export function normalizeLayout(layout: PanelLayout): PanelLayout {
  const seen = new Set<string>();
  const rest: PanelSpec[] = [];
  let main: PanelSpec = { id: MAIN_PANEL, label: 'Main' };
  for (const panel of layout.panels ?? []) {
    if (!panel || typeof panel.id !== 'string' || seen.has(panel.id)) continue;
    seen.add(panel.id);
    if (panel.id === MAIN_PANEL) main = { ...main, ...panel };
    else rest.push(panel);
  }
  return { panels: [main, ...rest], placement: layout.placement ?? {} };
}

/** The panel a series is in: its placement when that panel exists, otherwise `main`. */
export function panelOf(layout: PanelLayout, seriesId: string): string {
  const wanted = layout.placement[seriesId];
  return wanted !== undefined && layout.panels.some((p) => p.id === wanted) ? wanted : MAIN_PANEL;
}

/**
 * Split `height` into bands by weight, top to bottom, with no gaps. A band is never shorter than 40 while the height
 * allows it; with too little height the bands share what there is.
 */
export function panelBands(panels: readonly PanelSpec[], height: number): PanelBand[] {
  const total = Number.isFinite(height) && height > 0 ? height : 1;
  const weights = panels.map(weightOf);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const floor = Math.min(MIN_BAND, total / Math.max(1, panels.length));
  let heights = weights.map((w) => Math.max(floor, (total * w) / sum));
  // Taking the floor from some bands can overshoot; scale the bands that were above it back down.
  const over = heights.reduce((a, b) => a + b, 0) - total;
  if (over > 0.001) {
    const spare = heights.reduce((a, h) => a + Math.max(0, h - floor), 0);
    if (spare > 0) heights = heights.map((h) => h - (Math.max(0, h - floor) / spare) * over);
  }
  let top = 0;
  return panels.map((p, i) => {
    const h = i === panels.length - 1 ? Math.max(0, total - top) : Math.round(heights[i] * 100) / 100;
    const band = { id: p.id, top: Math.round(top * 100) / 100, height: h };
    top += h;
    return band;
  });
}

/** Where a series can go: an existing panel, or a new one beside the panel it is in. */
export type MoveDestination =
  | { kind: 'panel'; panelId: string }
  | { kind: 'new'; side: 'above' | 'below'; beside: string };

export interface MoveTarget {
  destination: MoveDestination;
  /** The words for a button, for example "Move up to Main" or "Move to a new panel below". */
  label: string;
}

/**
 * The destinations for one series, relative to where it is: the panel above, the panel below, a new panel above, a new
 * panel below. A destination that would change nothing is left out (a lone series in a panel gains nothing from a new
 * panel beside its own), and so is "new panel above" for `main`, which stays first.
 */
export function moveTargets(layout: PanelLayout, seriesId: string): MoveTarget[] {
  const here = panelOf(layout, seriesId);
  const at = layout.panels.findIndex((p) => p.id === here);
  const out: MoveTarget[] = [];
  const above = layout.panels[at - 1];
  const below = layout.panels[at + 1];
  if (above) out.push({ destination: { kind: 'panel', panelId: above.id }, label: `Move up to ${above.label}` });
  if (below) out.push({ destination: { kind: 'panel', panelId: below.id }, label: `Move down to ${below.label}` });
  const alone = here !== MAIN_PANEL && layout.panels.length > 0 && Object.keys(layout.placement).filter((id) => panelOf(layout, id) === here).length <= 1;
  if (here !== MAIN_PANEL && !alone) out.push({ destination: { kind: 'new', side: 'above', beside: here }, label: 'Move to a new panel above' });
  if (!alone) out.push({ destination: { kind: 'new', side: 'below', beside: here }, label: 'Move to a new panel below' });
  return out;
}

const nextPanelId = (panels: readonly PanelSpec[]): { id: string; label: string } => {
  let n = panels.length;
  const ids = new Set(panels.map((p) => p.id));
  while (ids.has(`panel-${n}`)) n++;
  return { id: `panel-${n}`, label: `Panel ${n}` };
};

/**
 * Move a series. Returns the same layout object when nothing changes. A panel left with no series is removed (never
 * `main`). The result is a new layout: the arguments are not changed.
 */
export function moveSeries(layout: PanelLayout, seriesId: string, destination: MoveDestination): PanelLayout {
  const here = panelOf(layout, seriesId);
  let panels = [...layout.panels];
  let target: string;
  if (destination.kind === 'panel') {
    if (!panels.some((p) => p.id === destination.panelId) || destination.panelId === here) return layout;
    target = destination.panelId;
  } else {
    const beside = panels.findIndex((p) => p.id === destination.beside);
    if (beside < 0) return layout;
    if (destination.side === 'above' && panels[beside].id === MAIN_PANEL) return layout; // main stays first
    const made = nextPanelId(panels);
    panels.splice(destination.side === 'above' ? beside : beside + 1, 0, { id: made.id, label: made.label });
    target = made.id;
  }
  const placement = { ...layout.placement, [seriesId]: target };
  const used = new Set(Object.keys(placement).map((id) => panelOf({ panels, placement }, id)));
  panels = panels.filter((p) => p.id === MAIN_PANEL || used.has(p.id) || p.id === target);
  return { panels, placement };
}

/** The words for a live region after a move, for example "Moved RSI to Panel 2." */
export function describeMove(label: string, panelLabel: string): string {
  return `Moved ${label} to ${panelLabel}.`;
}

/** A series as `reconcileLayout` reads it: its id and the panel it asks to start in. */
export interface PanelSeriesRequest { id: string; panel?: string }

/**
 * Bring an uncontrolled layout in step with a changed list of series, keeping every placement a person already made.
 * A series that is new (not in `seen`) starts in the panel it names, which is created below `main` when it does not
 * exist (labelled from `named`, else its id). A series that is gone loses its placement, and a panel left with no
 * series is removed. Returns the same layout when nothing changes.
 */
export function reconcileLayout(layout: PanelLayout, series: readonly PanelSeriesRequest[], seen: readonly string[], named: readonly PanelSpec[] = []): PanelLayout {
  const now = new Set(series.map((s) => s.id));
  const before = new Set(seen);
  let panels = [...layout.panels];
  const placement: Record<string, string> = { ...layout.placement };
  let changed = false;
  for (const id of seen) if (!now.has(id) && id in placement) { delete placement[id]; changed = true; }
  for (const s of series) {
    if (before.has(s.id) || !s.panel || s.panel === MAIN_PANEL) continue;
    if (!panels.some((p) => p.id === s.panel)) panels.push(named.find((n) => n.id === s.panel) ?? { id: s.panel, label: s.panel });
    placement[s.id] = s.panel;
    changed = true;
  }
  const used = new Set(Object.keys(placement).map((id) => placement[id]));
  const kept = panels.filter((p) => p.id === MAIN_PANEL || used.has(p.id));
  if (kept.length !== panels.length) { panels = kept; changed = true; }
  return changed ? { panels, placement } : layout;
}
