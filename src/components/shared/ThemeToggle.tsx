import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../context/themeContext';

interface ThemeToggleProps {
  compact?: boolean;
  showLabel?: boolean;
  className?: string;
}

export function ThemeToggle({
  compact = false,
  showLabel = false,
  className = '',
}: ThemeToggleProps) {
  const { isDark, toggleTheme } = useTheme();
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      data-testid="theme-toggle-btn"
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-50 hover:text-[#0B1A2E] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white ${
        compact ? 'min-h-[40px] min-w-[40px] px-2.5' : 'min-h-[40px] px-3 py-2 text-xs font-semibold'
      } ${className}`}
    >
      {isDark ? (
        <Sun className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4 shrink-0 text-[#1E88E5]" aria-hidden="true" />
      )}
      {showLabel ? <span>{isDark ? 'Light mode' : 'Dark mode'}</span> : null}
    </button>
  );
}
