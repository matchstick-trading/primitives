import { createContext, useCallback, useContext, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Notice } from './Notice.js';
import { receiptHash, receiptVerdict, resolveReceiptKey, type ReceiptData, type ReceiptHashOf } from './core/receipt-rules.js';

/**
 * Receipt as parts: Root, Field, Hash, CopyButton, ShareNote, Verdict. Headless: the parts add
 * `data-verdict` (match or mismatch) and `data-synthetic` (on the card itself, without the `data-mt` scope, so tokens.css
 * does not paint the whole card; the Verdict part carries the scope), and a copy always says whether it worked.
 *
 * Enter or `y` anywhere in the receipt (not on a button or link, which keep their own Enter) copies the result
 * hash. A receipt for data that is not synthetic must carry its `shareNote`; ShareNote prints it, and the contract
 * (`receiptPropsSchema`) refuses a receipt without one.
 */
/** `from` is the button that copied, or `key` for Enter or y, so only one button says how it went. */
interface CopyStatus { text: string; ok: boolean; from: 'receipt' | 'hash' | 'key' }
interface ReceiptContext {
  receipt: ReceiptData;
  receiptText: string;
  copy: (text: string, what: string, from: CopyStatus['from']) => Promise<void>;
  status: CopyStatus | null;
  /** How many hash buttons there are: a key copy reports under one of them, or under the receipt button if none. */
  hashButtons: number;
  addHashButton: () => () => void;
}
const Context = createContext<ReceiptContext | null>(null);

function useReceipt(part: string): ReceiptContext {
  const context = useContext(Context);
  if (!context) throw new Error(`Receipt.${part} needs a Receipt.Root above it.`);
  return context;
}

export interface ReceiptRootProps {
  receipt: ReceiptData;
  /** The whole receipt as text, for the Copy receipt button. The host owns the wording. */
  receiptText: string;
  /** Writes text to the clipboard; the default is `navigator.clipboard.writeText`. Rejecting means it could not copy. */
  onCopy?: (text: string) => Promise<void>;
  className?: string;
  'aria-label'?: string;
  children?: ReactNode;
}

function Root({ receipt, receiptText, onCopy, className, 'aria-label': label = 'Evidence receipt', children }: ReceiptRootProps) {
  const [status, setStatus] = useState<CopyStatus | null>(null);
  const [hashButtons, setHashButtons] = useState(0);
  const addHashButton = useCallback(() => {
    setHashButtons((n) => n + 1);
    return () => setHashButtons((n) => n - 1);
  }, []);
  const copy = useCallback(async (text: string, what: string, from: CopyStatus['from']) => {
    try {
      await (onCopy ? onCopy(text) : navigator.clipboard.writeText(text));
      setStatus({ text: `${what} copied.`, ok: true, from });
    } catch {
      setStatus({ text: 'Could not copy here. Select the text and copy it.', ok: false, from });
    }
  }, [onCopy]);
  const context = useMemo<ReceiptContext>(() => ({ receipt, receiptText, copy, status, hashButtons, addHashButton }), [receipt, receiptText, copy, status, hashButtons, addHashButton]);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (resolveReceiptKey(event.nativeEvent, event.target as HTMLElement) !== 'copy-hash') return;
    event.preventDefault();
    event.stopPropagation(); // Enter and y are not for the page's shortcuts while a receipt is focused
    void copy(receipt.resultHash, 'Result hash', 'key');
  };
  return (
    <Context.Provider value={context}>
      <section className={className} aria-label={label} data-synthetic={receipt.synthetic ? '' : undefined} data-verdict={receiptVerdict(receipt)} onKeyDown={onKeyDown}>
        {children}
      </section>
    </Context.Provider>
  );
}

/** One labelled fact: a `<dt>` and a `<dd>` for a `<dl>`. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (<><dt>{label}</dt><dd>{children}</dd></>);
}

/** A digest as recorded, in a focusable `<code>` so a keyboard user can land on it and press Enter or `y`. */
function Hash({ of, className }: { of: ReceiptHashOf; className?: string }) {
  const { receipt } = useReceipt('Hash');
  return <code className={className} data-mt-numeric="" tabIndex={0}>{receiptHash(receipt, of)}</code>;
}

/**
 * A button that copies the whole receipt (or just the result hash), then says whether it worked. Only the button that
 * copied shows the status; a copy by Enter or y shows under the hash button, or the receipt button when there is none.
 */
function CopyButton({ what = 'receipt', className, statusClassName, children }: { what?: 'receipt' | 'hash'; className?: string; statusClassName?: string; children?: ReactNode }) {
  const { receipt, receiptText, copy, status, hashButtons, addHashButton } = useReceipt('CopyButton');
  useEffect(() => (what === 'hash' ? addHashButton() : undefined), [what, addHashButton]);
  const shown = status !== null && (status.from === what || (status.from === 'key' && (what === 'hash' || hashButtons === 0))) ? status : null;
  return (
    <>
      <button type="button" className={className} onClick={() => void (what === 'hash' ? copy(receipt.resultHash, 'Result hash', 'hash') : copy(receiptText, 'Receipt', 'receipt'))}>
        {children ?? (what === 'hash' ? 'Copy result hash' : 'Copy receipt')}
      </button>
      <Notice as="span" kind={shown === null ? 'info' : shown.ok ? 'ok' : 'error'} className={statusClassName}>{shown?.text ?? ''}</Notice>
    </>
  );
}

/** The line that must travel with a copy of non-synthetic data; nothing when there is none. */
function ShareNote({ className }: { className?: string }) {
  const { receipt } = useReceipt('ShareNote');
  if (!receipt.shareNote) return null;
  return <p className={className}>{receipt.shareNote}</p>;
}

/** Whether replaying from the start gave the same result, in words. Tokens.css colours a mismatch. */
function Verdict({ className, matchText = 'Same two states and the same result hash.', mismatchText = 'Did not reproduce the same result.' }: { className?: string; matchText?: string; mismatchText?: string }) {
  const { receipt } = useReceipt('Verdict');
  const verdict = receiptVerdict(receipt);
  return <span className={className} data-mt="" data-verdict={verdict}>{verdict === 'match' ? matchText : mismatchText}</span>;
}

export { Root, Field, Hash, CopyButton, ShareNote, Verdict };
