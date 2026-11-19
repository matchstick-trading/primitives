import { useEffect, useState } from 'react';
import { Chart, Scrubber, Transport } from '@matchstick-trading/primitives';
import '@matchstick-trading/primitives/tokens.css';
import { bars, proposals as initial } from './data';
import type { Proposal } from './data';
import { ProposalMarks } from './ProposalMarks';

const last = bars.length - 1;
// Start with 12 bars already in view, so the first chart is a row of candles and not one stretched candle.
// The first proposal is on bar 13, so it still arrives during the replay.
const START = 11;
const time = (ms: number) => new Date(ms).toISOString().slice(11, 16) + ' UTC';

export default function App() {
  // The replay is one number: how many bars have been revealed.
  const [bar, setBar] = useState(START);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  // The review lives here, in this file. Each proposal carries its own accepted: null | true | false.
  const [proposals, setProposals] = useState<Proposal[]>(initial);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setBar((b) => Math.min(last, b + 1)), 400 / speed);
    return () => clearInterval(timer);
  }, [playing, speed]);

  useEffect(() => {
    if (bar >= last) setPlaying(false);
  }, [bar]);

  // A proposal shows up once the replay reaches its bar, and is left alone for you to decide.
  const arrived = proposals.filter((p) => p.time <= bars[bar].timestamp);
  const review = (id: string, accepted: boolean | null) =>
    setProposals((all) => all.map((p) => (p.id === id ? { ...p, accepted } : p)));
  const count = (state: boolean | null) => arrived.filter((p) => p.accepted === state).length;

  return (
    <main>
      <h1>Review an agent’s trades</h1>
      <p>A made-up agent suggests six trades on a made-up session. Press Play. Each suggestion appears when the replay reaches it: accept or reject it. Nothing is sent anywhere.</p>
      <Chart.Root bars={bars.slice(0, bar + 1)} synthetic aria-label="Replay of a made-up session with an agent’s suggested trades">
        <Chart.Plot>
          <Chart.Grid />
          <Chart.Volume />
          <Chart.Candles style="candle" />
          <ProposalMarks proposals={arrived} />
          <Chart.PriceAxis />
          <Chart.TimeAxis />
          <Chart.Crosshair />
        </Chart.Plot>
        <Chart.Readout />
      </Chart.Root>
      <Scrubber.Root
        fraction={bar / last}
        onCommit={(fraction) => setBar(Math.max(START, Math.round(fraction * last)))}
        onStep={(direction) => setBar((b) => Math.min(last, Math.max(START, b + direction)))}
      >
        <Scrubber.Track>
          <Scrubber.Thumb label="Replay position" />
        </Scrubber.Track>
      </Scrubber.Root>
      <Transport.Root playing={playing} aria-label="Replay controls">
        <Transport.Group>
          <Transport.Start onClick={() => { setPlaying(false); setBar(START); }}>Start</Transport.Start>
          <Transport.Previous onClick={() => setBar((b) => Math.max(START, b - 1))}>Back</Transport.Previous>
          <Transport.Play onClick={() => { if (bar >= last) setBar(START); setPlaying((p) => !p); }}>{playing ? 'Pause' : 'Play'}</Transport.Play>
          <Transport.Next onClick={() => setBar((b) => Math.min(last, b + 1))}>Forward</Transport.Next>
        </Transport.Group>
        <Transport.Speed speed={speed} options={[1, 2, 4]} onSpeedChange={setSpeed} format={(x) => `${x}x`} />
        <Transport.Readout>Bar {bar + 1} of {bars.length}</Transport.Readout>
      </Transport.Root>

      <section aria-labelledby="review-heading">
        <h2 id="review-heading">Suggestions</h2>
        <p role="status">{arrived.length === 0 ? 'None yet. Press Play.' : `${count(true)} accepted, ${count(false)} rejected, ${count(null)} waiting`}</p>
        <ul className="proposals">
          {arrived.map((p) => {
            const label = `${p.side} ${p.size} at ${p.price.toFixed(2)}, ${time(p.time)}`;
            const state = p.accepted === null ? 'Waiting' : p.accepted ? 'Accepted' : 'Rejected';
            return (
              <li key={p.id} className={`proposal state-${state.toLowerCase()}`}>
                <strong>{p.side === 'buy' ? 'Buy' : 'Sell'} {p.size} at {p.price.toFixed(2)}</strong> <span>{time(p.time)}</span>
                <p>{p.note}</p>
                <div className="actions">
                  <span className="state">{state}</span>
                  <button type="button" aria-pressed={p.accepted === true} aria-label={`Accept: ${label}`} onClick={() => review(p.id, p.accepted === true ? null : true)}>Accept</button>
                  <button type="button" aria-pressed={p.accepted === false} aria-label={`Reject: ${label}`} onClick={() => review(p.id, p.accepted === false ? null : false)}>Reject</button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
