import { useChart } from '@matchstick-trading/primitives';
import type { Proposal } from './data';

// Primitives has no trade-marker part in this version, so this draws the marks with useChart(). It must sit inside
// Chart.Plot. The look shows the review: waiting = faint, accepted = solid, rejected = struck through. The state is
// also in the list beside the chart, so colour is never the only signal.
export function ProposalMarks({ proposals }: { proposals: readonly Proposal[] }) {
  const { frame, bars, readoutId } = useChart('ProposalMarks');
  const span = frame.priceMax - frame.priceMin || 1;
  const y = (price: number) => frame.priceTop + ((frame.priceMax - price) / span) * (frame.priceBottom - frame.priceTop);
  return (
    <g aria-hidden="true" clipPath={`url(#${readoutId}-price)`}>
      {proposals.map((proposal) => {
        const index = bars.findIndex((bar) => bar.timestamp === proposal.time);
        if (index < frame.first || index > frame.last) return null;
        const x = (index - frame.viewport.start + 0.5) * frame.barWidth;
        const state = proposal.accepted === null ? 'waiting' : proposal.accepted ? 'accepted' : 'rejected';
        return (
          <text key={proposal.id} x={x} y={y(proposal.price)} textAnchor="middle" className={`mark mark-${proposal.side} mark-${state}`}>
            {proposal.side === 'buy' ? '▲' : '▼'}
          </text>
        );
      })}
    </g>
  );
}
