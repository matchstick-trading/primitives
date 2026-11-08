/**
 * Full-screen rules with no DOM in them. The Frame and Toggle parts do the browser work; these are the words and the one
 * decision that needs care: who gets Escape.
 */

/** What the live region says on entering and leaving full screen. */
export const FULLSCREEN_MESSAGE = { entered: 'Full screen', exited: 'Exited full screen' } as const;

/** The Toggle's default accessible names: the action it will do, not the state it is in. */
export const FULLSCREEN_LABEL = { enter: 'Full screen', exit: 'Exit full screen' } as const;

/** Who handles an Escape pressed while the frame is expanded. */
export type FullscreenEscape = 'exit' | 'chart';

/** What the parts around the focused chart still hold that an Escape should release first. */
export interface FullscreenEscapeInput {
  /** Focus is on the chart's plot. */
  inPlot: boolean;
  /** The crosshair is showing, or something in the plot is selected (a drawing, the series, a study). */
  plotHasMark: boolean;
  /** A drawing tool is armed, or a drawing is half placed. These take the first Escape from anywhere in the frame. */
  drawingBusy: boolean;
}

/**
 * The Escape rule. Anything that handles Escape itself goes first: an open menu or the Edit form (they stop the key
 * before it gets here), a drawing tool that is armed or a drawing half placed, and, with focus on the chart, the
 * crosshair or a selection of any kind. With none of those, Escape leaves full screen.
 */
export function resolveFullscreenEscape(input: FullscreenEscapeInput): FullscreenEscape {
  return input.drawingBusy || (input.inPlot && input.plotHasMark) ? 'chart' : 'exit';
}
