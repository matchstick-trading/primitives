import { createContext, useCallback, useContext, useId, useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { DEPTH_HEIGHT, DEPTH_WIDTH, depthGeometry, depthLevelId, nextDepthIndex, resolveDepthKey, type DepthGeometry, type DepthLevel } from './core/depth-profile.js';

/**
 * DepthProfile as parts: Root, Plot, Bids, Asks, Axis, Crosshair, Readout, Table. Headless: the
 * parts draw cumulative depth for each side and add `data-side`. A chart alone is a picture, so the same levels are
 * also a Table; a keyboard user moves a crosshair level by level and a Readout says where it is in words.
 *
 * Prices and sizes are exact decimal strings and are printed as given. A tap or click on the Plot puts the crosshair on the
 * nearest level (a touch screen has no arrow keys); the keyboard and the Table are the other ways in.
 */
interface DepthContext extends DepthGeometry {
  active: number | null;
  setActive: (index: number | null) => void;
  readoutId: string;
}
const Context = createContext<DepthContext | null>(null);

function useDepth(part: string): DepthContext {
  const context = useContext(Context);
  if (!context) throw new Error(`DepthProfile.${part} needs a DepthProfile.Root above it.`);
  return context;
}

export interface DepthProfileRootProps {
  /** Best price first on each side. */
  levels: readonly DepthLevel[];
  /** Controlled crosshair: the `side:price` id of the level, or null for none. */
  active?: string | null;
  onActiveChange?: (id: string | null) => void;
  className?: string;
  'aria-label'?: string;
  children?: ReactNode;
}

function Root({ levels: given, active, onActiveChange, className, 'aria-label': label = 'Cumulative order-book depth', children }: DepthProfileRootProps) {
  const levels = useMemo(() => (Array.isArray(given) ? given.filter((level) => level != null) : []), [given]); // no list, or a hole in it, is left out
  const geometry = useMemo(() => depthGeometry(levels), [levels]);
  const [inner, setInner] = useState<string | null>(null);
  const controlled = active !== undefined;
  const activeId = controlled ? active : inner;
  const index = activeId === null ? -1 : geometry.ordered.findIndex((l) => depthLevelId(l) === activeId);
  const readoutId = useId();
  const setActive = useCallback((next: number | null) => {
    const id = next === null ? null : depthLevelId(geometry.ordered[next]);
    if (!controlled) setInner(id);
    onActiveChange?.(id);
  }, [geometry, controlled, onActiveChange]);
  const context = useMemo<DepthContext>(() => ({ ...geometry, active: index < 0 ? null : index, setActive, readoutId }), [geometry, index, setActive, readoutId]);
  return (
    <Context.Provider value={context}>
      <figure className={className} aria-label={label}>{children}</figure>
    </Context.Provider>
  );
}

/** The drawing. One tab stop; a tap or click picks the nearest level; ArrowLeft/Right move the crosshair, Home/End jump to the ends, Escape clears it. */
function Plot({ className, label = 'Bid and ask cumulative depth', children }: { className?: string; label?: string; children?: ReactNode }) {
  const { ordered, active, setActive, readoutId, x } = useDepth('Plot');
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const action = resolveDepthKey(event);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation(); // arrows, Home and End are also transport shortcuts on the page
    setActive(nextDepthIndex(ordered, active, action));
  };
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    const svg = event.currentTarget;
    const matrix = svg.getScreenCTM();
    if (!ordered.length || !matrix) return;
    // Through the inverse screen transform, so the letterboxing of preserveAspectRatio is accounted for.
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const at = point.matrixTransform(matrix.inverse()).x;
    let nearest = 0;
    for (let i = 1; i < ordered.length; i++) {
      if (Math.abs(x(ordered[i].price) - at) < Math.abs(x(ordered[nearest].price) - at)) nearest = i;
    }
    setActive(nearest);
  };
  return (
    <svg className={className} viewBox={`0 0 ${DEPTH_WIDTH} ${DEPTH_HEIGHT}`} role="group" aria-label={label} aria-describedby={readoutId} tabIndex={0} onKeyDown={onKeyDown} onPointerDown={onPointerDown}>
      {children}
    </svg>
  );
}

function Bids({ className }: { className?: string }) {
  const { bidPoints } = useDepth('Bids');
  return <polygon className={className} data-part="depth-bids" data-side="bid" points={bidPoints} />;
}

function Asks({ className }: { className?: string }) {
  const { askPoints } = useDepth('Asks');
  return <polygon className={className} data-part="depth-asks" data-side="ask" points={askPoints} />;
}

/** The lowest and highest price on the plot, as recorded, at its two ends. */
function Axis({ className }: { className?: string }) {
  const { ordered } = useDepth('Axis');
  if (ordered.length === 0) return null;
  const low = ordered[0].price;
  const high = ordered[ordered.length - 1].price;
  return (
    <g className={className} data-part="depth-axis" aria-hidden="true">
      <text x={0} y={DEPTH_HEIGHT - 2} textAnchor="start">{low}</text>
      <text x={DEPTH_WIDTH} y={DEPTH_HEIGHT - 2} textAnchor="end">{high}</text>
    </g>
  );
}

/** A line and a point at the active level; nothing is drawn while there is none. */
function Crosshair({ className }: { className?: string }) {
  const { ordered, active, x, y } = useDepth('Crosshair');
  if (active === null) return null;
  const level = ordered[active];
  return (
    <g className={className} data-part="depth-crosshair" data-side={level.side} aria-hidden="true">
      <line x1={x(level.price)} x2={x(level.price)} y1={0} y2={DEPTH_HEIGHT} />
      <circle cx={x(level.price)} cy={y(level.cumulative)} r={4} />
    </g>
  );
}

/** The active level in words, announced politely. The host may pass its own wording. */
function Readout({ className, format }: { className?: string; format?: (level: DepthLevel) => string }) {
  const { ordered, active, readoutId } = useDepth('Readout');
  const level = active === null ? null : ordered[active];
  const text = level === null ? '' : format ? format(level) : `${level.side === 'bid' ? 'Bid' : 'Ask'} ${level.price}, cumulative size ${level.cumulative}`;
  return <output id={readoutId} className={className} aria-live="polite" data-side={level?.side}>{text}</output>;
}

/** The same levels as a table: the text equivalent of the plot. Prices run low to high. */
function Table({ className, caption = 'Cumulative depth by price level' }: { className?: string; caption?: string }) {
  const { ordered, active } = useDepth('Table');
  return (
    <table className={className}>
      <caption>{caption}</caption>
      <thead><tr><th scope="col">Side</th><th scope="col">Price</th><th scope="col">Cumulative size</th></tr></thead>
      <tbody>
        {ordered.map((level, i) => (
          <tr key={depthLevelId(level)} data-side={level.side} aria-current={i === active ? 'true' : undefined}>
            <td>{level.side === 'bid' ? 'Bid' : 'Ask'}</td>
            <td data-mt-numeric>{level.price}</td>
            <td data-mt-numeric>{level.cumulative}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export { Root, Plot, Bids, Asks, Axis, Crosshair, Readout, Table };
