import { createContext, useCallback, useContext, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { describeBarsCsv, parseBarsCsv, type CsvBarsResult } from './core/csv-bars.js';

export interface CsvDropLoad extends CsvBarsResult {
  fileName: string;
}

type CsvDropState =
  | { kind: 'idle' }
  | { kind: 'reading'; fileName: string }
  | { kind: 'loaded'; load: CsvDropLoad }
  | { kind: 'error'; message: string };

interface CsvDropContext {
  state: CsvDropState;
  read: (file: File) => void;
}

const Ctx = createContext<CsvDropContext | null>(null);

function useCsvDrop(): CsvDropContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('CsvDrop parts must be inside CsvDrop.Root');
  return ctx;
}

export interface CsvDropRootProps {
  /** Called after every read with the bars and what was skipped; the host decides what to show. */
  onLoad: (load: CsvDropLoad) => void;
  /** Bigger files are refused before reading. Default 50 MB. */
  maxBytes?: number;
  /** More rows than this are refused. Default 500,000. */
  maxRows?: number;
  className?: string;
  children?: ReactNode;
}

/**
 * A drop area for the user's own CSV file. The file is read in the browser and never leaves the page. Drop a file
 * on the area, or use CsvDrop.Input (the keyboard path: a native file picker). State shows as `data-state`
 * ('idle' | 'reading' | 'loaded' | 'error') and `data-dragging` while a file is over the area.
 */
function Root({ onLoad, maxBytes = 50 * 1024 * 1024, maxRows, className, children }: CsvDropRootProps) {
  const [state, setState] = useState<CsvDropState>({ kind: 'idle' });
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  // Each read gets a number; a slower earlier read that finishes late is dropped, so the newest file always wins.
  const generation = useRef(0);
  const read = useCallback((file: File) => {
    const id = ++generation.current;
    if (file.size > maxBytes) {
      setState({ kind: 'error', message: `${file.name} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB, so it wasn't read.` });
      return;
    }
    setState({ kind: 'reading', fileName: file.name });
    file.text().then(
      (text) => {
        if (id !== generation.current) return;
        const load = { ...parseBarsCsv(text, { maxRows }), fileName: file.name };
        setState({ kind: 'loaded', load });
        onLoad(load);
      },
      () => { if (id === generation.current) setState({ kind: 'error', message: `${file.name} couldn't be read.` }); },
    );
  }, [maxBytes, maxRows, onLoad]);

  const hasFile = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  return (
    <Ctx.Provider value={{ state, read }}>
      <div
        data-mt=""
        data-part="csv-drop"
        data-state={state.kind}
        data-dragging={dragging ? '' : undefined}
        className={className}
        onDragEnter={(e) => { if (!hasFile(e)) return; e.preventDefault(); depth.current++; setDragging(true); }}
        onDragOver={(e) => { if (hasFile(e)) e.preventDefault(); }}
        onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setDragging(false); }}
        onDrop={(e) => {
          if (!hasFile(e)) return;
          e.preventDefault();
          depth.current = 0;
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) read(file);
        }}
      >
        {children}
      </div>
    </Ctx.Provider>
  );
}

/** The native file picker, labelled by its children. Accepts .csv, .tsv and .txt. */
function Input({ className, children }: { className?: string; children?: ReactNode }) {
  const { read } = useCsvDrop();
  return (
    <label data-part="csv-input" className={className}>
      {children}
      <input
        type="file"
        accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) read(file);
          e.target.value = '';
        }}
      />
    </label>
  );
}

/** A polite status line: reading, how many bars loaded, and which rows were skipped and why. */
function Status({ className, idle }: { className?: string; idle?: ReactNode }) {
  const { state } = useCsvDrop();
  let text: ReactNode = idle ?? null;
  if (state.kind === 'reading') text = `Reading ${state.fileName}…`;
  if (state.kind === 'loaded') text = describeBarsCsv(state.load, state.load.fileName);
  if (state.kind === 'error') text = state.message;
  const failed = state.kind === 'error' || (state.kind === 'loaded' && state.load.bars.length === 0);
  return (
    <p role="status" aria-live="polite" data-part="csv-status" data-kind={failed ? 'error' : undefined} className={className}>
      {text}
    </p>
  );
}

export { Root, Input, Status };
