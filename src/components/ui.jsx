/** Small presentational primitives shared across every page. */

export function cx(...parts) {
  return parts.filter(Boolean).join(' ')
}

export function Button({ variant = 'primary', size = 'md', className, ...props }) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ' +
    'disabled:opacity-50 disabled:cursor-not-allowed'
  const sizes = {
    sm: 'px-2.5 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-base',
  }
  const variants = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
    secondary: 'bg-panel text-ink-2 border border-line-strong hover:bg-hover shadow-sm',
    ghost: 'text-ink-2 hover:bg-hover',
    danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
  }
  return <button className={cx(base, sizes[size], variants[variant], className)} {...props} />
}

export function Card({ className, children, ...props }) {
  return (
    <div
      className={cx(
        'rounded-xl border border-line bg-panel shadow-sm',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Field({ label, hint, error, children, className }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-3">
        {label}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-ink-4">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-on-danger">{error}</span>}
    </label>
  )
}

const controlClass =
  'w-full rounded-lg border border-line-strong bg-panel px-3 py-2 text-sm text-ink ' +
  'shadow-sm transition placeholder:text-ink-4 ' +
  'focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 ' +
  'disabled:bg-subtle disabled:text-ink-3'

export function Input({ className, ...props }) {
  return <input className={cx(controlClass, className)} {...props} />
}

export function Select({ className, children, ...props }) {
  return (
    <select className={cx(controlClass, 'pr-8', className)} {...props}>
      {children}
    </select>
  )
}

export function Checkbox({ label, className, ...props }) {
  return (
    <label className={cx('inline-flex items-center gap-2 text-sm text-ink-2', className)}>
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-line-strong text-brand-600 focus:ring-brand-500"
        {...props}
      />
      {label}
    </label>
  )
}

export function Alert({ tone = 'info', title, children, onDismiss }) {
  const tones = {
    info: 'bg-tint-info border-edge-info text-on-info',
    success: 'bg-tint-success border-edge-success text-on-success',
    warning: 'bg-tint-warning border-edge-warning text-on-warning',
    error: 'bg-tint-danger border-edge-danger text-on-danger',
  }
  return (
    <div className={cx('rounded-lg border px-4 py-3 text-sm', tones[tone])} role="status">
      <div className="flex items-start justify-between gap-3">
        <div>
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="shrink-0 text-lg leading-none opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
    </div>
  )
}

export function Badge({ tone = 'slate', children }) {
  const tones = {
    slate: 'bg-subtle text-ink-2',
    green: 'bg-tint-success text-on-success',
    red: 'bg-tint-danger text-on-danger',
    amber: 'bg-tint-warning text-on-warning',
    blue: 'bg-tint-info text-on-info',
  }
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tones[tone],
      )}
    >
      {children}
    </span>
  )
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-ink-3">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-brand-600" />
      {label}
    </div>
  )
}

export function EmptyState({ title, children }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-ink-3">{children}</p>}
    </div>
  )
}

export function Stat({ label, value, sub, tone }) {
  const tones = {
    good: 'text-on-success',
    bad: 'text-on-danger',
    neutral: 'text-ink',
  }
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <p className={cx('tabular mt-1 text-xl font-semibold', tones[tone] || tones.neutral)}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-ink-4">{sub}</p>}
    </div>
  )
}

export function Th({ className, children, ...props }) {
  return (
    <th
      className={cx(
        'whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-2',
        className,
      )}
      {...props}
    >
      {children}
    </th>
  )
}

export function Td({ className, children, ...props }) {
  return (
    <td className={cx('whitespace-nowrap px-3 py-2 text-sm text-ink-2', className)} {...props}>
      {children}
    </td>
  )
}
