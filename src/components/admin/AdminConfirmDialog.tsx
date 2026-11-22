import React from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';

interface AdminConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const AdminConfirmDialog: React.FC<AdminConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel,
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1A2E]/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-confirm-title"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                tone === 'danger'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-[#1E88E5]/10 text-[#1E88E5]'
              }`}
            >
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h3
                id="admin-confirm-title"
                className="font-display text-base font-bold text-[#0B1A2E]"
              >
                {title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                {description}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            aria-label="Close confirmation dialog"
            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-[#0B1A2E]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-[#0B1A2E] hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
              tone === 'danger'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-[#1E88E5] hover:bg-[#1565C0]'
            }`}
          >
            {busy && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
