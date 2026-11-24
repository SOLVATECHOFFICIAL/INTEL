import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, MessageCircle, Share2 } from 'lucide-react';

export interface ShareActionMenuProps {
  shareUrl: string;
  title: string;
  text?: string;
  variant?: 'icon' | 'button';
  label?: string;
  align?: 'left' | 'right';
  ariaLabel?: string;
  buttonClassName?: string;
  testId?: string;
}

export const ShareActionMenu: React.FC<ShareActionMenuProps> = ({
  shareUrl,
  title,
  text,
  variant = 'icon',
  label = 'Share',
  align = 'right',
  ariaLabel,
  buttonClassName,
  testId,
}) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const supportsNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const whatsappText = text ? `${text}\n${shareUrl}` : `${title}\n${shareUrl}`;
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(whatsappText)}`;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleCopyLink = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const helper = document.createElement('textarea');
        helper.value = shareUrl;
        helper.setAttribute('readonly', 'true');
        helper.style.position = 'fixed';
        helper.style.opacity = '0';
        document.body.appendChild(helper);
        helper.select();
        document.execCommand('copy');
        document.body.removeChild(helper);
      }
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
        setOpen(false);
      }, 1500);
    } catch {
      setCopied(false);
    }
  };

  const handleNativeShare = async () => {
    if (!supportsNativeShare) return;
    try {
      await navigator.share({
        title,
        text: text ?? title,
        url: shareUrl,
      });
      setOpen(false);
    } catch {
      // User dismissed native share sheet or browser cancelled
    }
  };

  const defaultButtonClass =
    variant === 'button'
      ? 'inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1A2E] transition-colors hover:bg-slate-50'
      : 'inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-[#0B1A2E]';

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        aria-label={ariaLabel ?? `Share ${title}`}
        aria-expanded={open}
        title="Share"
        className={buttonClassName ?? defaultButtonClass}
        data-testid={testId}
      >
        {copied ? (
          <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        ) : (
          <Share2 className="h-4 w-4" aria-hidden="true" />
        )}
        {variant === 'button' && (
          <span>{copied ? 'Copied' : label}</span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Share options"
          onClick={(e) => e.stopPropagation()}
          className={`absolute top-full z-40 mt-1.5 w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg ${
            align === 'left' ? 'left-0' : 'right-0'
          }`}
        >
          <button
            type="button"
            onClick={() => void handleCopyLink()}
            className="flex min-h-[36px] w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-[#0B1A2E] transition-colors hover:bg-slate-100"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5 shrink-0 text-[#1E88E5]" aria-hidden="true" />
            )}
            <span>{copied ? 'Link copied' : 'Copy direct link'}</span>
          </button>

          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="mt-0.5 flex min-h-[36px] w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-[#0B1A2E] transition-colors hover:bg-slate-100"
          >
            <MessageCircle className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
            <span>Share to WhatsApp</span>
          </a>

          {supportsNativeShare && (
            <button
              type="button"
              onClick={() => void handleNativeShare()}
              className="mt-0.5 flex min-h-[36px] w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-[#0B1A2E] transition-colors hover:bg-slate-100"
            >
              <Share2 className="h-3.5 w-3.5 shrink-0 text-[#1E88E5]" aria-hidden="true" />
              <span>Share via device...</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
