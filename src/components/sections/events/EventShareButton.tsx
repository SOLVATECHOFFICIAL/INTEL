import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';
import type { CampusEvent } from '../../../types/database';
import { buildEventShareUrl, formatEventDateTimeRange } from '../../../utils/events';

interface EventShareButtonProps {
  event: Pick<CampusEvent, 'id' | 'title' | 'venue' | 'eventDate' | 'endDate' | 'timeLabel'>;
}

export const EventShareButton: React.FC<EventShareButtonProps> = ({ event }) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const shareUrl = buildEventShareUrl(event.id);
  const supportsNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

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
        title: event.title,
        text: `${event.title} · ${formatEventDateTimeRange(event)} at ${event.venue}`,
        url: shareUrl,
      });
      setOpen(false);
    } catch {
      // User cancelled native share sheet or browser blocked call
    }
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        aria-label={`Share ${event.title}`}
        aria-expanded={open}
        title="Share event"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#0B1A2E]"
        data-testid={`event-share-btn-${event.id}`}
      >
        <Share2 className="h-4 w-4" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Share event options"
          onClick={(e) => e.stopPropagation()}
          className="absolute top-full right-0 z-30 mt-1.5 w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"
        >
          <button
            type="button"
            onClick={() => void handleCopyLink()}
            className="flex min-h-[36px] w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-[#0B1A2E] hover:bg-slate-100"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5 shrink-0 text-[#1E88E5]" aria-hidden="true" />
            )}
            <span>{copied ? 'Link copied' : 'Copy direct link'}</span>
          </button>

          {supportsNativeShare && (
            <button
              type="button"
              onClick={() => void handleNativeShare()}
              className="mt-0.5 flex min-h-[36px] w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-[#0B1A2E] hover:bg-slate-100"
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
