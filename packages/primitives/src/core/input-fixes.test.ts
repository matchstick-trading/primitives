import { describe, expect, it } from 'vitest';
import { csvAdapter } from './adapter';
import { chartFrame, lastBars, type CandleBar } from './chart-scale';
import { parseBarsCsv } from './csv-bars';
import { snapToBar } from './drawings';
import { applyTick } from './live';
import { resolveScrubKey } from './scrubber-gesture';

// Made-up data only. These pin input fixes from the Fable round 2 bug hunt (DEV-2026-11-552).
const T = Date.UTC(2024, 0, 2, 14, 30);
const HEAD = 'time,open,high,low,close,volume\n';

describe('csv input fixes', () => {
  it('reads an hours-only offset (+01, -05, +00) as that zone', () => {
    const at = (zone: string) => parseBarsCsv(`${HEAD}2024-01-02T09:30:00${zone},1,2,0.5,1.5,10`);
    expect(at('+01').errors).toEqual([]);
    expect(at('+01').bars[0]?.timestamp).toBe(Date.UTC(2024, 0, 2, 8, 30));
    expect(at('-05').bars[0]?.timestamp).toBe(Date.UTC(2024, 0, 2, 14, 30));
    expect(at('+00').bars[0]?.timestamp).toBe(Date.UTC(2024, 0, 2, 9, 30));
  });

  it('does not read a thousands comma as a decimal comma in a tab file with decimal points', () => {
    const volume = parseBarsCsv('time\topen\thigh\tlow\tclose\tvolume\n1704205800\t4725.50\t4730.25\t4720.00\t4728.75\t12,345');
    expect(volume.bars[0]?.volume).toBe(12345);
    const price = parseBarsCsv('time\topen\thigh\tlow\tclose\tvolume\n1704205800\t4,725\t4,731\t4,720\t4,729\t100\n1704205860\t4729.5\t4731.0\t4728.0\t4730.25\t100');
    expect(price.bars[0]?.close).toBe(4729);
  });

  it('keeps a decimal comma in a semicolon file with no decimal points', () => {
    expect(parseBarsCsv('time;open;high;low;close;volume\n1704205800;1,085;1,09;1,08;1,086;5').bars[0]?.open).toBe(1.085);
  });

  it('reads a 14-digit and a 12-digit stamp as that date-time, not as a Unix time', () => {
    const r = parseBarsCsv(`${HEAD}20240102143000,1,2,0.5,1.5,10\n202401021431,1,2,0.5,1.5,10`);
    expect(r.errors).toEqual([]);
    expect(r.bars.map((b) => b.timestamp)).toEqual([T, T + 60_000]);
  });

  it('still reads a 12-digit Unix millisecond time that is not a date', () => {
    expect(parseBarsCsv(`${HEAD}946684800000,1,2,0.5,1.5,10`).bars[0]?.timestamp).toBe(Date.UTC(2000, 0, 1));
  });

  it('does not read a volatility or vol_change column as volume', () => {
    const r = csvAdapter.read('time,open,high,low,close,vol_change\n1704205800,1,2,0.5,1.5,-0.04\n1704205860,1,2,0.5,1.5,0.02');
    expect(r.errors).toEqual([]);
    expect(r.bars.map((b) => b.volume)).toEqual([0, 0]);
    expect(r.series.map((s) => s.label)).toEqual(['vol_change']);
  });

  it('still reads "Volume USD" style names as volume', () => {
    expect(parseBarsCsv('time,open,high,low,close,Volume USD\n1704205800,1,2,0.5,1.5,7').bars[0]?.volume).toBe(7);
  });

  it('reports extra columns of a header-less file and a blank-header column as series', () => {
    const headerless = csvAdapter.read('1704205800,1,2,0.5,1.5,10,77.5\n1704205860,1,2,0.5,1.5,11,78.5');
    expect(headerless.series.map((s) => s.label)).toEqual(['Column 7']);
    const blank = csvAdapter.read(`${HEAD.trimEnd()},\n1704205800,1,2,0.5,1.5,10,77.5\n1704205860,1,2,0.5,1.5,11,78.5`);
    expect(blank.series.map((s) => s.label)).toEqual(['Column 7']);
  });

  it('returns an error result, never a throw, for input that is not text', () => {
    for (const input of [undefined, null, 42, {}] as unknown[]) {
      const r = csvAdapter.read(input as string);
      expect(r.bars).toEqual([]);
      expect(r.errors.length).toBeGreaterThan(0);
    }
    expect(() => csvAdapter.read(`${HEAD}1704205800,1,2,0.5,1.5,10`, null as never)).not.toThrow();
  });
});

describe('bars without volume', () => {
  const noVolume = { timestamp: 0, open: 1, high: 1, low: 1, close: 1 } as unknown as CandleBar;

  it('applyTick folds a tick into a bar without volume to a finite volume', () => {
    const out = applyTick([noVolume], { timestamp: 10, price: 2, size: 3 }, 60_000);
    expect(out.outcome).toBe('updated');
    expect(out.bars[0]!.volume).toBe(3);
  });

  it('the volume scale gives a bar without volume an empty bar, not NaN', () => {
    const frame = chartFrame([noVolume, { ...noVolume, timestamp: 60_000, volume: 5 }], lastBars(2, 120), { width: 800, height: 420 });
    expect(frame.volumeY(undefined as unknown as number)).toBe(frame.volumeBottom);
    expect(Number.isFinite(frame.volumeY(5))).toBe(true);
  });
});

describe('drawings and scrubber input fixes', () => {
  it('snapToBar with no bars makes no anchor, not one at 1970', () => {
    const frame = chartFrame([], lastBars(0, 120), { width: 800, height: 420 });
    for (const mode of ['off', 'magnet'] as const) expect(snapToBar({ x: 300, y: 200 }, [], frame, mode)).toBeNull();
  });

  it('a scrub key with Alt, Ctrl or Meta held is left to the browser', () => {
    for (const mod of ['altKey', 'ctrlKey', 'metaKey'] as const) {
      for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) expect(resolveScrubKey(key, 0.5, { [mod]: true })).toBeNull();
    }
    expect(resolveScrubKey('ArrowLeft', 0.5, { altKey: false })).toEqual({ type: 'step', direction: -1 });
  });
});

describe('mixed decimal conventions in one semicolon file', () => {
  const head = 'time;open;high;low;close;volume\n';
  it('fails the mixed file with an error naming the row, and still loads a consistent comma-decimal file', () => {
    const mixed = parseBarsCsv(`${head}2024-01-02T09:30:00Z;1.080;1.090;1.070;1.085;10\n2024-01-02T09:31:00Z;1,08;1,09;1,07;1,085;10`);
    expect(mixed.errors.some((e) => e.line === 3)).toBe(true);
    expect(mixed.bars.some((b) => b.close === 1085 || b.close === 109)).toBe(false);
    const consistent = parseBarsCsv(`${head}2024-01-02T09:30:00Z;1,080;1,090;1,070;1,085;10`);
    expect(consistent.errors).toEqual([]);
    expect(consistent.bars[0]?.close).toBeCloseTo(1.085);
  });
});

// Codex review round 5 on the 0.0.13 sync: a row that is refused for its time must not decide how every other row's prices are read.
describe('parseBarsCsv: the decimal convention comes from rows that can be read', () => {
  it('keeps 1,080 as 1.080 in a semicolon file when the only point-decimal row has a bad time', () => {
    const csv = 'time;open;high;low;close\n1704205800;1,080;1,090;1,070;1,085\nnot-a-time;1.080;1.090;1.070;1.085';
    const { bars, errors } = parseBarsCsv(csv);
    expect(errors.map((e) => e.line)).toEqual([3]);
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ open: 1.08, high: 1.09, low: 1.07, close: 1.085 });
  });
});

// Codex review round 7: a semicolon file whose prices all carry a thousands comma still writes decimal points.
describe('parseBarsCsv: grouped prices settle the point convention', () => {
  it('reads 4,725.50 in a semicolon file', () => {
    const { bars, errors } = parseBarsCsv('time;open;high;low;close;volume\n2026-01-05T14:30:00Z;4,725.50;4,730.25;4,720.00;4,728.75;100');
    expect(errors).toEqual([]);
    expect(bars[0]).toMatchObject({ open: 4725.5, high: 4730.25, low: 4720, close: 4728.75 });
  });
});
