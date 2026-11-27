import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { parseLinkSegments } from '../../utils/linkText';

export type LinkifiedTextTone = 'default' | 'on-dark' | 'on-light-card';

interface LinkifiedTextProps {
  text: string;
  className?: string;
  as?: 'p' | 'span' | 'div';
  tone?: LinkifiedTextTone;
  maxLabelLength?: number;
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fallback below
    }
  }
  if (typeof document === 'undefined') return false;
  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Renders arbitrary prose with auto-detected, one-tap clickable external links
 * (opening in a new browser tab) paired with an immediate inline Copy button.
 */
export const LinkifiedText: React.FC<LinkifiedTextProps> = ({
  text,
  className = '',
  as: Component = 'p',
  tone = 'default',
  maxLabelLength = 54,
}) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  if (!text) {
    return null;
  }

  const segments = parseLinkSegments(text);
  const hasLinks = segments.some((segment) => segment.type === 'link');

  if (!hasLinks) {
    return <Component className={className}>{text}</Component>;
  }

  const linkClass =
    tone === 'on-dark'
      ? 'inline-flex max-w-full items-center gap-1 break-all font-semibold text-sky-200 underline decoration-sky-200/70 underline-offset-2 transition-colors hover:text-white'
      : tone === 'on-light-card'
      ? 'inline-flex max-w-full items-center gap-1 break-all font-semibold text-[#0D47A1] underline decoration-[#0D47A1]/60 underline-offset-2 transition-colors hover:text-[#0B1A2E]'
      : 'inline-flex max-w-full items-center gap-1 break-all font-semibold text-[#1565C0] underline decoration-[#1E88E5]/55 underline-offset-2 transition-colors hover:text-[#0B1A2E] dark:text-sky-400 dark:decoration-sky-400/55 dark:hover:text-sky-300';

  const copyBtnBase =
    tone === 'on-dark'
      ? 'border-white/25 bg-white/15 text-white hover:bg-white/25'
      : tone === 'on-light-card'
      ? 'border-slate-900/20 bg-white/85 text-[#0B1A2E] hover:bg-white'
      : 'border-slate-200 bg-slate-100 text-[#0B1A2E] hover:border-[#1E88E5]/45 hover:bg-sky-50 hover:text-[#1565C0] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-sky-500/50 dark:hover:bg-sky-950/60 dark:hover:text-sky-300';

  const copiedBtnStyle =
    tone === 'on-dark'
      ? 'border-emerald-300/60 bg-emerald-500/30 text-emerald-50'
      : 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-950/50 dark:text-emerald-300';

  const handleCopy = async (
    event: React.MouseEvent<HTMLButtonElement>,
    href: string,
    index: number
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const ok = await copyTextToClipboard(href);
    if (!ok) return;
    setCopiedIndex(index);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setCopiedIndex(null);
    }, 1800);
  };

  return (
    <Component className={className}>
      {segments.map((segment, index) => {
        if (segment.type !== 'link' || !segment.href) {
          return <React.Fragment key={`t-${index}`}>{segment.value}</React.Fragment>;
        }

        const isCopied = copiedIndex === index;
        const label =
          segment.value.length > maxLabelLength
            ? `${segment.value.slice(0, Math.max(12, maxLabelLength - 1))}…`
            : segment.value;

        return (
          <span
            key={`l-${index}`}
            className="mx-0.5 inline-flex max-w-full flex-wrap items-center gap-1 align-baseline"
          >
            <a
              href={segment.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title={`Open ${segment.href} in a new browser tab`}
              className={linkClass}
            >
              <span>{label}</span>
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            </a>
            <button
              type="button"
              onClick={(e) => void handleCopy(e, segment.href!, index)}
              title={`Copy link: ${segment.href}`}
              aria-label={isCopied ? 'Link copied' : `Copy ${segment.value}`}
              className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px] font-semibold leading-none transition-colors ${
                isCopied ? copiedBtnStyle : copyBtnBase
              }`}
            >
              {isCopied ? (
                <>
                  <Check className="h-2.5 w-2.5" aria-hidden="true" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-2.5 w-2.5" aria-hidden="true" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </span>
        );
      })}
    </Component>
  );
};
