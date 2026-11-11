import { describe, expect, it } from 'vitest';
import { reduceScrubGesture, scrubKeysAllowed } from './scrubber-gesture.js';

describe('a second press during a scrub', () => {
  it('begins one gesture, ends it once and commits once, wherever the first release lands', () => {
    const events: string[] = [];
    let drag: number | null = null;
    const run = (e: Parameters<typeof reduceScrubGesture>[0]) => {
      const r = reduceScrubGesture(e, drag);
      drag = r.dragFraction;
      if (r.begin) events.push('begin');
      if (r.end) events.push('end');
      if (r.commit !== null) events.push('commit ' + r.commit);
    };
    run({ type: 'down', fraction: 0.2 });
    run({ type: 'down', fraction: 0.6 });
    run({ type: 'up', fraction: 0.6 });
    expect(events).toEqual(['begin', 'end', 'commit 0.6']);
    expect(drag).toBeNull();
  });
});

describe('thumb keys during a scrub', () => {
  it('do nothing while a drag is in progress or the host is loading, and act otherwise', () => {
    expect(scrubKeysAllowed({ dragFraction: 0.4, loading: false })).toBe(false);
    expect(scrubKeysAllowed({ dragFraction: null, loading: true })).toBe(false);
    expect(scrubKeysAllowed({ dragFraction: null, loading: false })).toBe(true);
  });
});
