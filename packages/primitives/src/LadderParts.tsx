import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from 'react';
import { primitiveAttributes } from './attributes.js';
import { useLadderKeys } from './ladder-keys.js';
import { LADDER_ROW_ATTRIBUTE } from './core/ladder-keys.js';
import { buildLadder, type LadderBuilt, type LadderInput, type LadderIssue, type LadderRow } from './core/ladder.js';

/**
 * Ladder as parts: Root, Table, Row, Last, Price, Size, Traded, Status. Headless: the parts are real table elements and
 * add `data-ladder-side`, `data-best` and a `--mt-bar` width for the size bars; the host chooses the columns.
 *
 * Asks are drawn highest first, then the divider row (the last price and the spread), then bids highest first. Prices
 * group by `step` (bids round down, asks round up) and sizes are summed exactly. The keys are the ladder keys: arrows
 * move between rows, Home is the best bid and End the best ask; the table has one tab stop. It is read-only: no key
 * places or changes an order. A level that breaks a rule is listed by Status and is not drawn.
 */
interface LadderContext {
  stop: string | undefined;
  issues: LadderIssue[];
}
const Context = createContext<LadderContext | null>(null);

function useLadder(part: string): LadderContext {
  const context = useContext(Context);
  if (!context) throw new Error(`Ladder.${part} needs a Ladder.Root above it.`);
  return context;
}

export interface LadderRootProps extends LadderInput {
  className?: string;
  /** The parts, given the grouped rows. */
  children: (built: LadderBuilt) => ReactNode;
}

function Root({ bids, asks, step, levels, last, traded, className, children }: LadderRootProps) {
  const keys = useLadderKeys();
  const built = useMemo(() => buildLadder({ bids, asks, step, levels, last, traded }), [bids, asks, step, levels, last, traded]);
  const best = built.bids.find((r) => r.best) ?? built.asks.find((r) => r.best);
  const stop = keys.tabStop(built.rows.map((r) => r.id), best?.id);
  const context = useMemo<LadderContext>(() => ({ stop, issues: built.issues }), [stop, built.issues]);
  return (
    <Context.Provider value={context}>
      <div className={className} data-mt="" {...keys.containerProps}>
        {children(built)}
      </div>
    </Context.Provider>
  );
}

/** The table. */
function Table({ caption, className, captionClassName, children }: { caption: string; className?: string; captionClassName?: string; children: ReactNode }) {
  return (
    <table className={className}>
      <caption className={captionClassName}>{caption}</caption>
      {children}
    </table>
  );
}

/** One price level. A single tab stop for the ladder: the focused row, or the best bid. */
function Row({ row, className, children }: { row: LadderRow; className?: string; children: ReactNode }) {
  const { stop } = useLadder('Row');
  return (
    <tr
      className={className}
      data-ladder-side={row.side}
      data-best={row.best ? row.side : undefined}
      {...{ [LADDER_ROW_ATTRIBUTE]: row.id }}
      tabIndex={row.id === stop ? 0 : -1}
    >
      {children}
    </tr>
  );
}

/** The divider between asks and bids: the last price and the spread. Not a stop for the keys. */
function Last({ last, colSpan = 3, className, children }: { last: LadderBuilt['last']; colSpan?: number; className?: string; children?: ReactNode }) {
  return (
    <tr className={className} data-ladder-last="">
      <td colSpan={colSpan} data-mt-numeric="">
        {children ?? (
          <>
            <span>{last.price ? `Last ${last.price}` : 'No trade yet'}</span>
            {last.spread && <span> · Spread {last.spread}</span>}
          </>
        )}
      </td>
    </tr>
  );
}

/** The price, as the bucket's exact string; the B or A mark and colour come from tokens.css. */
function Price({ row, className }: { row: LadderRow; className?: string }) {
  return <th scope="row" className={className} data-mt-numeric="" {...primitiveAttributes({ side: row.side })}>{row.price}</th>;
}

/** The size, with a bar behind it as wide as the size is large next to the largest row shown. */
function Size({ row, className }: { row: LadderRow; className?: string }) {
  return <td className={className} data-mt-numeric="" data-mt="" data-ladder-bar={row.side} style={{ ['--mt-bar' as string]: row.fraction } as CSSProperties}>{row.size}</td>;
}

/** Size traded at this price, empty when none. */
function Traded({ row, className }: { row: LadderRow; className?: string }) {
  return <td className={className} data-mt-numeric="">{row.traded ?? ''}</td>;
}

/** Levels left out for breaking a rule, and a crossed book. */
function Status({ className }: { className?: string }) {
  const { issues } = useLadder('Status');
  if (!issues.length) return null;
  const text = issues.slice(0, 3).map((i) => `${i.where}${i.index !== undefined ? ` ${i.index + 1}` : ''}: ${i.message}`).join('; ');
  return <p className={className} role="status">{issues.length} {issues.length === 1 ? 'problem' : 'problems'} in the book. {text}{issues.length > 3 ? '; …' : ''}.</p>;
}

export { Root, Table, Row, Last, Price, Size, Traded, Status };
