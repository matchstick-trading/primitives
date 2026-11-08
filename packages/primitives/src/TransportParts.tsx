import { createContext, useContext, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { Notice } from './Notice.js';

/**
 * Transport as parts: Root, Group, Play, Previous, Next, Start, End, Speed, Readout, Boundary.
 * Headless: parts render plain buttons and a readout and add `data-state`,
 * `data-disabled` and `data-boundary`. The host owns the handlers and the copy. Keyboard shortcuts stay with the
 * host; a suggested map: Space, ArrowLeft/Right, J/K, Home and End.
 */
interface TransportContext {
  playing: boolean;
  loading: boolean;
}
const Context = createContext<TransportContext>({ playing: false, loading: false });

export interface TransportRootProps {
  playing: boolean;
  /** Another operation is running: Previous, Next, Start and End are disabled; Play is aria-disabled and ignores activation. */
  loading?: boolean;
  /** Set when the cursor sits at the start or the end of the session. */
  boundary?: 'start' | 'end' | null;
  className?: string;
  'aria-label'?: string;
  children?: ReactNode;
}

function Root({ playing, loading = false, boundary = null, className, 'aria-label': label = 'Replay transport', children }: TransportRootProps) {
  return (
    <Context.Provider value={{ playing, loading }}>
      <nav className={className} aria-label={label} data-state={playing ? 'playing' : 'paused'} data-boundary={boundary ?? undefined}>
        {children}
      </nav>
    </Context.Provider>
  );
}

function Group({ className, label, children }: { className?: string; label?: string; children?: ReactNode }) {
  return label ? (
    <div className={className} role="group" aria-label={label}>{children}</div>
  ) : (
    <div className={className}>{children}</div>
  );
}

export type PartButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'disabled'>;

/** The play toggle is never `disabled`: disabling the focused button would drop focus to <body> mid-gesture. */
function Play({ onClick, ...rest }: PartButtonProps) {
  const { playing, loading } = useContext(Context);
  return (
    <button
      type="button"
      {...rest}
      onClick={(event) => {
        if (loading) return;
        onClick?.(event);
      }}
      aria-disabled={loading ? 'true' : undefined}
      data-state={playing ? 'playing' : 'paused'}
      data-disabled={loading ? '' : undefined}
    />
  );
}

// The explicit type keeps the emitted .d.ts naming PartButtonProps; inferred, it expands every attribute from the React types
// the package was built against, and those names (SubmitEventHandler, ToggleEventHandler) do not exist in React 18.
export type StepButton = { (props: PartButtonProps): ReactElement; displayName?: string };
function stepButton(name: string): StepButton {
  const Part: StepButton = (props: PartButtonProps) => {
    const { loading } = useContext(Context);
    return <button type="button" {...props} disabled={loading} data-disabled={loading ? '' : undefined} />;
  };
  Part.displayName = `Transport.${name}`;
  return Part;
}
const Previous = stepButton('Previous');
const Next = stepButton('Next');
const Start = stepButton('Start');
const End = stepButton('End');

export interface TransportSpeedProps {
  speed: number;
  options: readonly number[];
  onSpeedChange: (speed: number) => void;
  /** Text for one option, for example `formatSpeed`. */
  format: (speed: number) => string;
  className?: string;
  labelClassName?: string;
  label?: string;
  'aria-label'?: string;
}

function Speed({ speed, options = [], onSpeedChange, format = (value: number) => `${value}x`, className, labelClassName, label = 'Speed', 'aria-label': ariaLabel = 'Playback speed, multiple of real time' }: TransportSpeedProps) {
  return (
    <label className={className}>
      <span className={labelClassName}>{label}</span>
      <select value={String(speed)} onChange={(event) => onSpeedChange(Number(event.target.value))} aria-label={ariaLabel}>
        {(options ?? []).map((option) => (
          <option key={option} value={String(option)}>
            {format(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Not announced while playing: the readout changes every frame. */
function Readout({ className, children }: { className?: string; children?: ReactNode }) {
  const { playing } = useContext(Context);
  return (
    <output className={className} aria-live={playing ? 'off' : 'polite'}>
      {children}
    </output>
  );
}

/** A normal boundary condition, not a failure: polite status text, nothing when no boundary is reached. */
function Boundary({ label, className }: { label: string | null; className?: string }) {
  if (!label) return null;
  return (
    <Notice as="span" kind="info" className={className}>
      {label}
    </Notice>
  );
}

export { Root, Group, Play, Previous, Next, Start, End, Speed, Readout, Boundary };
