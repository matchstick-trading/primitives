import { useChart } from '@matchstick-trading/primitives';
import type { Trade } from './data';

// Primitives has no trade-marker part yet, so this draws one on top of the chart. It must sit inside
// Chart.Plot: useChart() gives the frame (which bars are in view, the price range, the bar width).
export function TradeMarks({ trades }: { trades: readonly Trade[] }) {
  const { frame, bars, readoutId } = useChart('TradeMarks');
  const span = frame.priceMax - frame.priceMin || 1;
  const y = (price: number) => frame.priceTop + ((frame.priceMax - price) / span) * (frame.priceBottom - frame.priceTop);
  return (
    <g aria-hidden="true" clipPath={`url(#${readoutId}-price)`}>
      {trades.map((trade) => {
        const index = bars.findIndex((bar) => bar.timestamp === trade.time);
        if (index < frame.first || index > frame.last) return null;
        const x = (index - frame.viewport.start + 0.5) * frame.barWidth;
        return (
          <text key={`${trade.time}-${trade.side}`} x={x} y={y(trade.price)} textAnchor="middle" className={`mark-${trade.side}`}>
            {trade.side === 'buy' ? '▲' : '▼'}
          </text>
        );
      })}
    </g>
  );
}
