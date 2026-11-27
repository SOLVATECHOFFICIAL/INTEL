import type { ReactNode } from 'react';

export interface SectionRibbonItem<T extends string = string> {
  id: T;
  label: string;
  count?: number;
  icon?: ReactNode;
  badgeDot?: boolean;
  disabled?: boolean;
}

interface SectionRibbonProps<T extends string = string> {
  items: readonly SectionRibbonItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  variant?: 'primary' | 'sublist';
  className?: string;
}

export function SectionRibbon<T extends string = string>({
  items,
  activeId,
  onChange,
  ariaLabel,
  variant = 'primary',
  className = '',
}: SectionRibbonProps<T>) {
  const isSublist = variant === 'sublist';

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`no-scrollbar flex w-full items-center gap-1.5 overflow-x-auto ${
        isSublist
          ? 'rounded-xl border border-slate-200/90 bg-slate-100/90 p-1 dark:border-slate-800 dark:bg-slate-800/75'
          : 'pb-0.5'
      } ${className}`}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        const baseClasses =
          'relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E88E5] disabled:cursor-not-allowed disabled:opacity-50';

        const variantClasses = isSublist
          ? active
            ? 'min-h-[36px] rounded-lg bg-white px-3 py-1.5 text-xs text-[#0B1A2E] shadow-sm dark:bg-slate-900 dark:text-white'
            : 'min-h-[36px] rounded-lg px-3 py-1.5 text-xs text-slate-600 hover:bg-white/70 hover:text-[#0B1A2E] dark:text-slate-300 dark:hover:bg-slate-900/60 dark:hover:text-white'
          : active
            ? 'min-h-[40px] rounded-xl bg-[#0B1A2E] px-3.5 py-2 text-xs text-white shadow-sm dark:bg-[#1E88E5] dark:text-white'
            : 'min-h-[40px] rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-700 hover:border-[#1E88E5]/40 hover:bg-sky-50/50 hover:text-[#0B1A2E] dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-sky-500/40 dark:hover:bg-slate-800 dark:hover:text-white';

        const countClasses = isSublist
          ? active
            ? 'bg-slate-100 text-[#0B1A2E] dark:bg-slate-800 dark:text-slate-100'
            : 'bg-slate-200/80 text-slate-700 dark:bg-slate-700/80 dark:text-slate-200'
          : active
            ? 'bg-white/20 text-white'
            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';

        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            data-testid={`ribbon-tab-${item.id}`}
            className={`${baseClasses} ${variantClasses}`}
          >
            {item.icon ? <span className="shrink-0">{item.icon}</span> : null}
            <span>{item.label}</span>
            {typeof item.count === 'number' ? (
              <span
                className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${countClasses}`}
              >
                {item.count}
              </span>
            ) : null}
            {item.badgeDot ? (
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-amber-400"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
