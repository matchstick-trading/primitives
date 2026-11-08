/**
 * The scrub gesture as plain data in, plain data out. Everything here works on a fraction of the
 * track, 0 to 1, and knows nothing about time, sequences or events: the host turns a committed fraction into a
 * place in its session. That keeps the rules testable without a DOM and keeps the Scrubber usable on any ruler.
 */

/** Clamp a track fraction to [0, 1]; a value that is not a finite number becomes 0. */
export function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export type ScrubGestureEvent =
  | { type: 'down'; fraction: number }
  | { type: 'move'; fraction: number }
  /**
   * `fraction` is where the release itself landed: pointer input coalesces, so the release can be measurably ahead
   * of the last move. When it is left out the last previewed fraction is used. `loading` is whether the host is
   * already busy with another navigation at the moment of release, passed in as data so the decision lives here.
   */
  | { type: 'up'; fraction?: number; loading?: boolean }
  | { type: 'cancel' };

export interface ScrubGestureResult {
  /** The next preview fraction; null when no drag is in progress. */
  dragFraction: number | null;
  /** Non-null exactly once per gesture: the fraction to commit when the pointer is released. */
  commit: number | null;
  begin: boolean;
  end: boolean;
}

const IDLE: Omit<ScrubGestureResult, 'dragFraction'> = { commit: null, begin: false, end: false };

/**
 * Moving only ever changes the preview; only a release, with a drag in progress, commits, and it commits once.
 * A release while the host is loading ends the gesture without committing, so two navigations are never in
 * flight at once. A cancelled gesture (the pointer left the window) never commits.
 */
export function reduceScrubGesture(event: ScrubGestureEvent, dragFraction: number | null): ScrubGestureResult {
  switch (event.type) {
    case 'down':
      return { dragFraction: clampFraction(event.fraction), commit: null, begin: true, end: false };
    case 'move':
      return dragFraction === null ? { dragFraction, ...IDLE } : { dragFraction: clampFraction(event.fraction), ...IDLE };
    case 'up':
      if (dragFraction === null) return { dragFraction: null, ...IDLE };
      if (event.loading) return { dragFraction: null, commit: null, begin: false, end: true };
      return { dragFraction: null, commit: clampFraction(event.fraction ?? dragFraction), begin: false, end: true };
    case 'cancel':
      return dragFraction === null ? { dragFraction: null, ...IDLE } : { dragFraction: null, commit: null, begin: false, end: true };
  }
}

/** The two pointer fields a scrub gate reads, named so the gates are testable without a DOM event. */
export interface ScrubPointer {
  /** 0 is the primary button (left, or a pen or touch contact). */
  button: number;
  /** False for any additional simultaneous contact in a multi-touch gesture. */
  isPrimary: boolean;
}

/** Whether a pointer-down may start a scrub. A right-click, middle-click or second finger is left to the browser. */
export function isPrimaryScrubPointer(event: ScrubPointer): boolean {
  return event.button === 0 && event.isPrimary;
}

/** Whether a move, up or cancel belongs to the pointer that began the drag now in progress (a second contact cannot hijack it). */
export function isActiveScrubPointer(pointerId: number, activePointerId: number | null): boolean {
  return activePointerId !== null && pointerId === activePointerId;
}

/** Where a pointer sits along a track, as a fraction. A track with no width reads as 0. */
export function fractionFromPointer(clientX: number, left: number, width: number): number {
  if (!(width > 0)) return 0;
  return clampFraction((clientX - left) / width);
}

export type ScrubKeyAction = { type: 'step'; direction: -1 | 1 } | { type: 'jump'; fraction: number };

/**
 * Arrow keys step one event, which only the host can define, so they resolve to a direction. Home and End jump to
 * the ends; PageUp and PageDown move 10% of the track. Any other key is left alone (null).
 */
export function resolveScrubKey(key: string, currentFraction: number): ScrubKeyAction | null {
  switch (key) {
    case 'ArrowLeft':
      return { type: 'step', direction: -1 };
    case 'ArrowRight':
      return { type: 'step', direction: 1 };
    case 'Home':
      return { type: 'jump', fraction: 0 };
    case 'End':
      return { type: 'jump', fraction: 1 };
    case 'PageUp':
      return { type: 'jump', fraction: clampFraction(currentFraction + 0.1) };
    case 'PageDown':
      return { type: 'jump', fraction: clampFraction(currentFraction - 0.1) };
    default:
      return null;
  }
}
