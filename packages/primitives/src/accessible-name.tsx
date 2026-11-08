import type { ReactNode } from 'react';

/**
 * The accessible-name rule. A control that is an icon and nothing else still names its action in words: the
 * words are the `aria-label`, and the icon is a decorative `data-part='icon'` span that assistive technology skips. No
 * icon ships in this package; `icon` is a slot the host fills.
 */
export interface NameProps {
  /** A graphic for the button, drawn before any words. It is hidden from assistive technology, so give the button words too. */
  icon?: ReactNode;
  /** The action in words. It is the visible text unless `hideLabel` is set, and always the accessible name. */
  label?: string;
  /** Show only the icon. The `label` then becomes the `aria-label`. Needs `icon`. */
  hideLabel?: boolean;
}

/**
 * What a button shows and what it is called. `fallback` is the part's own word ("Lock", "Reset view"). Visible text is
 * `children`, else `label`, else `fallback`; with `hideLabel` there is none and the name moves to `aria-label`.
 */
export function buttonFace(fallback: string | undefined, { icon, label, hideLabel, children, ariaLabel }: NameProps & { children?: ReactNode; ariaLabel?: string }): { 'aria-label': string | undefined; content: ReactNode } {
  const hasIcon = icon !== undefined && icon !== null && icon !== false;
  const visible = hideLabel && hasIcon ? null : (children ?? label ?? fallback ?? null);
  const name = ariaLabel ?? label ?? (typeof children === 'string' ? children : fallback);
  return {
    'aria-label': visible === null || visible === false || visible === '' ? name : ariaLabel,
    content: (
      <>
        {hasIcon && <span aria-hidden="true" data-part="icon">{icon}</span>}
        {visible}
      </>
    ),
  };
}
