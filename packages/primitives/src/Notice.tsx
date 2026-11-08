import type { ReactNode } from 'react';

export type NoticeKind = 'gap' | 'stale' | 'truncated' | 'unsupported' | 'rights' | 'info' | 'ok' | 'error';

export interface NoticeProps {
  /** `status` is polite (a normal condition); `alert` is for refusals and errors. */
  role?: 'status' | 'alert';
  kind?: NoticeKind;
  /** Element to render: a paragraph by default, a span for inline text. */
  as?: 'p' | 'span';
  /** Host class, kept so existing styles keep matching. */
  className?: string;
  children?: ReactNode;
}

/**
 * One integrity message. Replaces the repeated `<p role="status">` / `<p role="alert">` paragraphs: the same
 * element, role and class as before, plus `data-mt` (the scope the token styles hang on) and `data-kind` so a host can style by kind.
 */
export function Notice({ role = 'status', kind, as = 'p', className, children }: NoticeProps) {
  const Tag = as;
  return (
    <Tag role={role} className={className} data-mt data-kind={kind}>
      {children}
    </Tag>
  );
}
