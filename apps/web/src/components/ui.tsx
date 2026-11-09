'use client';

import Link from 'next/link';
import { ButtonHTMLAttributes, forwardRef, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, useEffect, useRef } from 'react';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-solder text-white hover:bg-solder-2 border-solder',
  secondary: 'bg-surface text-ink border-line hover:border-ink-3',
  ghost: 'bg-transparent text-ink-2 border-transparent hover:bg-line-2',
  danger: 'bg-surface text-fault border-fault/40 hover:bg-fault-tint',
};

export function Button({ variant = 'secondary', size = 'md', className, loading, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  return (
    <button
      type="button"
      {...p}
      disabled={p.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-ctl border font-semibold whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'h-8 px-3 text-sm' : size === 'lg' ? 'h-12 px-5 text-base' : 'h-10 px-4 text-sm',
        VARIANTS[variant],
        className,
      )}
    >
      {loading ? 'Working…' : children}
    </button>
  );
}

export function ButtonLink({ href, variant = 'secondary', className, children }: { href: string; variant?: Variant; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cx('inline-flex h-10 items-center justify-center gap-2 rounded-ctl border px-4 text-sm font-semibold', VARIANTS[variant], className)}>
      {children}
    </Link>
  );
}

const control = 'w-full rounded-ctl border border-line bg-surface px-3 text-[15px] text-ink placeholder:text-ink-3 focus:border-solder focus:outline-none disabled:bg-line-2';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} {...p} className={cx(control, 'h-10', className)} />;
});

export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cx(control, 'min-h-20 py-2', className)} />;
}

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...p} className={cx(control, 'h-10 pr-8', className)}>
      {children}
    </select>
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-sm font-semibold text-ink-2">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-fault">{error}</span>}
    </label>
  );
}

export function Panel({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx('rounded-panel border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line-2 px-4 py-3">
          <h2 className="text-[15px] font-bold">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-ink-2">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

type Tone = 'neutral' | 'good' | 'wait' | 'bad' | 'info';
const TONES: Record<Tone, string> = {
  neutral: 'bg-line-2 text-ink-2',
  good: 'bg-solder-tint text-solder-2',
  wait: 'bg-led-tint text-[#7a5600]',
  bad: 'bg-fault-tint text-fault',
  info: 'bg-[#e4ecf6] text-[#23466f]',
};
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx('inline-flex items-center rounded px-2 py-0.5 text-xs font-bold', TONES[tone])}>{children}</span>;
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-ink-3">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 font-semibold whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line-2 [&>tr:last-child]:border-0 [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top">{children}</tbody>
      </table>
      {!hasRows && <div className="px-3 py-10 text-center text-ink-3">{empty ?? 'Nothing here yet.'}</div>}
    </div>
  );
}

export function Alert({ tone = 'bad', children }: { tone?: 'bad' | 'good' | 'wait'; children: ReactNode }) {
  if (!children) return null;
  const t = tone === 'bad' ? 'border-fault/30 bg-fault-tint text-fault' : tone === 'good' ? 'border-solder/30 bg-solder-tint text-solder-2' : 'border-led/40 bg-led-tint text-[#7a5600]';
  return <div role={tone === 'bad' ? 'alert' : 'status'} className={cx('rounded-ctl border px-3 py-2 text-sm font-semibold', t)}>{children}</div>;
}

export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={cx('m-auto w-[calc(100%-2rem)] rounded-panel border border-line bg-surface p-0 text-ink backdrop:bg-ink/40', wide ? 'max-w-2xl' : 'max-w-md')}
    >
      {open && (
        <>
          <header className="flex items-center justify-between border-b border-line-2 px-5 py-3">
            <h2 className="text-lg font-bold">{title}</h2>
            <button type="button" onClick={onClose} className="rounded px-2 text-xl leading-none text-ink-3 hover:text-ink" aria-label="Close">
              ×
            </button>
          </header>
          <div className="max-h-[70dvh] overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-line-2 px-5 py-3">{footer}</footer>}
        </>
      )}
    </dialog>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'wait' | 'bad' }) {
  return (
    <div className="rounded-panel border border-line bg-surface p-4">
      <div className="text-sm text-ink-3">{label}</div>
      <div className={cx('num mt-1 text-2xl font-bold', tone === 'wait' && 'text-[#7a5600]', tone === 'bad' && 'text-fault')}>{value}</div>
      {sub && <div className="mt-1 text-sm text-ink-2">{sub}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="py-10 text-center text-ink-3">{label}</div>;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-line-2 px-3 py-2 text-sm text-ink-2">
      <span className="num">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
