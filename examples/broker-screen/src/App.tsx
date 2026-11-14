import { useEffect, useState } from 'react';
import { Chart, Ladder, Tape } from '@matchstick-trading/primitives';
import { applyTick } from '@matchstick-trading/primitives/core';
import '@matchstick-trading/primitives/tokens.css';
import { mockHistory, startMockBroker, type Book } from './mockBroker';

const BAR_MS = 5_000; // short bars so a new one opens every few seconds while you watch
const MAX_BARS = 120;
const MAX_TRADES = 200;

interface TapeEntry { id: string; t: string; price: string; size: string; side: 'buy' | 'sell' }
type Bars = ReturnType<typeof applyTick>['bars'];

export default function App() {
  const [bars, setBars] = useState<Bars>(() => mockHistory(Date.now(), 40, BAR_MS));
  const [trades, setTrades] = useState<TapeEntry[]>([]);
  const [book, setBook] = useState<Book>({ bids: [], asks: [] });
  const [last, setLast] = useState('');
  const [live, setLive] = useState(true);

  useEffect(() => {
    if (!live) return;
    let n = 0;
    return startMockBroker(
      (tick) => {
        // applyTick folds one tick into the newest bar, or opens a new bar when the interval rolls over.
        setBars((current) => applyTick(current, tick, BAR_MS).bars.slice(-MAX_BARS));
        setLast(tick.price.toFixed(2));
        n += 1;
        const entry: TapeEntry = { id: `t${tick.timestamp}-${n}`, t: new Date(tick.timestamp).toISOString(), price: tick.price.toFixed(2), size: String(tick.size), side: tick.side };
        setTrades((current) => [...current, entry].slice(-MAX_TRADES));
      },
      setBook,
    );
  }, [live]);

  return (
    <main>
      <h1>Broker screen</h1>
      <p>A chart, a ladder and a tape fed by a made-up broker feed. Nothing here is real market data.</p>
      <div className="screen">
        <div>
          {bars.length > 0 ? (
            <Chart.Root bars={bars} synthetic aria-label="Made-up live bars">
              <Chart.Plot>
                <Chart.Grid />
                <Chart.Volume />
                <Chart.Candles style="candle" />
                <Chart.PriceAxis />
                <Chart.TimeAxis />
                <Chart.Crosshair />
              </Chart.Plot>
              <Chart.Readout />
            </Chart.Root>
          ) : (
            <p>Waiting for the first tick.</p>
          )}
          <button onClick={() => setLive((on) => !on)}>{live ? 'Pause the feed' : 'Resume the feed'}</button>
        </div>
        <div>
          <Ladder.Root bids={book.bids} asks={book.asks} step="0.25" levels={8} last={last || undefined}>
            {(built) => (
              <Ladder.Table caption="Ladder">
                <tbody>
                  {built.asks.map((row) => (
                    <Ladder.Row key={row.id} row={row}><td><Ladder.Price row={row} /></td><td><Ladder.Size row={row} /></td></Ladder.Row>
                  ))}
                  <Ladder.Last last={built.last} colSpan={2} />
                  {built.bids.map((row) => (
                    <Ladder.Row key={row.id} row={row}><td><Ladder.Price row={row} /></td><td><Ladder.Size row={row} /></td></Ladder.Row>
                  ))}
                </tbody>
              </Ladder.Table>
            )}
          </Ladder.Root>
          <Tape.Root trades={trades} limit={10}>
            {(rows) => (
              <>
                <Tape.Table caption="Tape">
                  <tbody>
                    {rows.map((row) => (
                      <Tape.Row key={row.id} row={row}>
                        <td><Tape.Time row={row} /></td><td><Tape.Price row={row} /></td><td><Tape.Size row={row} /></td><td><Tape.Side row={row} /></td>
                      </Tape.Row>
                    ))}
                  </tbody>
                </Tape.Table>
                <Tape.Summary />
              </>
            )}
          </Tape.Root>
        </div>
      </div>
    </main>
  );
}
