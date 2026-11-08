import { useMemo, type ReactNode } from 'react';
import { useChart } from './ChartParts.js';
import { indexRangeOfTime, volumeProfile, type VolumeProfileResult } from './core/volume-profile.js';

/**
 * VolumeProfile as parts: Histogram, Table. The Histogram goes inside `Chart.Plot` and draws horizontal bars on the
 * right of the price pane, one per price row, lined up with the chart's price scale; lines mark the point of control
 * (the busiest row) and the value area's top and bottom. The Table says the same rows in text.
 *
 * Both read the bars in view, or a fixed `{ from, to }` range of timestamps (inclusive). Give both the same options.
 */
export interface VolumeProfileOptionsProps {
  /** Number of price rows. Default 24. */
  rows?: number;
  /** Share of the volume the value area holds. Default 0.7. */
  valueArea?: number;
  /** A fixed range of Unix-millisecond timestamps instead of the bars in view. */
  range?: { from: number; to: number };
}

function useProfile({ rows, valueArea, range }: VolumeProfileOptionsProps): VolumeProfileResult {
  const { bars, frame } = useChart('VolumeProfile');
  // The length is a dependency too: a host that pushes onto the same array must still get the new bars counted.
  const fixed = useMemo(() => (range ? indexRangeOfTime(bars, range.from, range.to) : null), [bars, bars.length, range?.from, range?.to]);
  const first = fixed ? fixed.first : frame.first;
  const last = fixed ? fixed.last : frame.last;
  return useMemo(() => volumeProfile(bars, { first, last, rows, valueArea }), [bars, bars.length, first, last, rows, valueArea]);
}

export interface VolumeProfileHistogramProps extends VolumeProfileOptionsProps {
  /** Width of the longest bar in chart units. Default a quarter of the frame. */
  width?: number;
  /** Draw the POC, VAH and VAL lines across the plot. Default true. */
  lines?: boolean;
  className?: string;
}

/**
 * Horizontal bars growing left from the right edge. Each row is a `<g data-part="profile-row">` with an up and a down
 * rect (`data-change`); `data-value-area` marks rows inside the value area and `data-poc` the busiest row.
 */
function Histogram({ width, lines = true, className, ...options }: VolumeProfileHistogramProps) {
  const { frame, readoutId } = useChart('VolumeProfile.Histogram');
  const result = useProfile(options);
  if (result.rows.length === 0 || result.poc < 0) return null;
  const longest = Math.max(1, Math.min(frame.plotWidth, Number.isFinite(width) ? Math.max(0, width as number) : frame.plotWidth * 0.25));
  const peak = result.rows[result.poc].volume;
  const [vaLow, vaHigh] = result.valueAreaRows;
  const right = frame.plotWidth;
  const nodes: ReactNode[] = [];
  result.rows.forEach((row, i) => {
    const top = frame.y(row.high);
    const height = Math.max(1, frame.y(row.low) - top);
    const upWidth = (row.upVolume / peak) * longest;
    const downWidth = (row.downVolume / peak) * longest;
    nodes.push(
      <g key={i} data-part="profile-row" data-value-area={i >= vaLow && i <= vaHigh ? '' : undefined} data-poc={i === result.poc ? '' : undefined}>
        <rect data-change="up" x={right - upWidth} y={top} width={upWidth} height={height} />
        <rect data-change="down" x={right - upWidth - downWidth} y={top} width={downWidth} height={height} />
      </g>,
    );
  });
  const line = (part: 'poc' | 'vah' | 'val', price: number | null) => {
    if (price === null || !Number.isFinite(price)) return null;
    const y = frame.y(price);
    return <line data-part={part} x1={0} x2={frame.plotWidth} y1={y} y2={y} />;
  };
  const poc = result.rows[result.poc];
  return (
    <g className={className} data-part="volume-profile" clipPath={`url(#${readoutId}-price)`} aria-hidden="true">
      {nodes}
      {lines && line('poc', (poc.low + poc.high) / 2)}
      {lines && line('vah', result.vah)}
      {lines && line('val', result.val)}
    </g>
  );
}

const volumeText = (v: number) => String(Math.round(v * 100) / 100);

/** The rows as a table, highest price first: price range, volume and share of the total. */
function Table({ className, caption = 'Volume by price', ...options }: VolumeProfileOptionsProps & { className?: string; caption?: string }) {
  const { decimals } = useChart('VolumeProfile.Table');
  const result = useProfile(options);
  const [vaLow, vaHigh] = result.valueAreaRows;
  const body: ReactNode[] = [];
  for (let i = result.rows.length - 1; i >= 0; i--) {
    const row = result.rows[i];
    body.push(
      <tr key={i} data-value-area={i >= vaLow && i <= vaHigh ? '' : undefined} data-poc={i === result.poc ? '' : undefined}>
        <td data-mt-numeric>{row.low.toFixed(decimals)} – {row.high.toFixed(decimals)}</td>
        <td data-mt-numeric>{volumeText(row.volume)}</td>
        <td data-mt-numeric>{result.total > 0 ? `${((row.volume / result.total) * 100).toFixed(1)}%` : '–'}</td>
      </tr>,
    );
  }
  return (
    <table className={className}>
      <caption>{caption}</caption>
      <thead><tr>{['Price', 'Volume', 'Share'].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
      <tbody>{body}</tbody>
    </table>
  );
}

export { Histogram, Table };
