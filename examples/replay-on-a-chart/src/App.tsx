import { useEffect, useState } from 'react';
import { Chart, Scrubber, Transport } from '@matchstick-trading/primitives';
import '@matchstick-trading/primitives/tokens.css';
import { bars, trades } from './data';
import { TradeMarks } from './TradeMarks';

const last = bars.length - 1;

export default function App() {
  // The replay is one number: how many bars have been revealed. The chart gets the bars up to it.
  const [bar, setBar] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setBar((b) => Math.min(last, b + 1)), 400 / speed);
    return () => clearInterval(timer);
  }, [playing, speed]);

  useEffect(() => {
    if (bar >= last) setPlaying(false);
  }, [bar]);

  const seen = trades.filter((trade) => trade.time <= bars[bar].timestamp);

  return (
    <main>
      <h1>Replay on a chart</h1>
      <p>Made-up bars and four made-up trades. Press Play, or drag the bar.</p>
      <Chart.Root bars={bars.slice(0, bar + 1)} synthetic aria-label="Replay of a made-up session">
        <Chart.Plot>
          <Chart.Grid />
          <Chart.Volume />
          <Chart.Candles style="candle" />
          <TradeMarks trades={seen} />
          <Chart.PriceAxis />
          <Chart.TimeAxis />
          <Chart.Crosshair />
        </Chart.Plot>
        <Chart.Readout />
      </Chart.Root>
      <Scrubber.Root
        fraction={bar / last}
        onCommit={(fraction) => setBar(Math.round(fraction * last))}
        onStep={(direction) => setBar((b) => Math.min(last, Math.max(0, b + direction)))}
      >
        <Scrubber.Track>
          <Scrubber.Thumb label="Replay position" />
        </Scrubber.Track>
      </Scrubber.Root>
      <Transport.Root playing={playing} aria-label="Replay controls">
        <Transport.Group>
          <Transport.Start onClick={() => { setPlaying(false); setBar(0); }}>Start</Transport.Start>
          <Transport.Previous onClick={() => setBar((b) => Math.max(0, b - 1))}>Back</Transport.Previous>
          <Transport.Play onClick={() => { if (bar >= last) setBar(0); setPlaying((p) => !p); }}>{playing ? 'Pause' : 'Play'}</Transport.Play>
          <Transport.Next onClick={() => setBar((b) => Math.min(last, b + 1))}>Forward</Transport.Next>
        </Transport.Group>
        <Transport.Speed speed={speed} options={[1, 2, 4]} onSpeedChange={setSpeed} format={(x) => `${x}x`} />
        <Transport.Readout>Bar {bar + 1} of {bars.length}</Transport.Readout>
      </Transport.Root>
    </main>
  );
}
