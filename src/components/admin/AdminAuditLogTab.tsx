import React, { useMemo, useState } from 'react';
import { ClipboardList, Loader2, Search } from 'lucide-react';
import type { UnifiedAuditEntry } from '../../services/adminDashboard';
import { formatAdminAuditActionLabel } from '../../utils/adminPermissions';
import { extractTimestampMs } from '../../utils/contextualSearch';

interface AdminAuditLogTabProps {
  entries: UnifiedAuditEntry[];
  loading: boolean;
}

type AuditCategoryFilter =
  | 'all'
  | 'badges'
  | 'marketplace'
  | 'content'
  | 'opps_events'
  | 'trusted_settings'
  | 'anonymous_reveals';

const FILTER_OPTIONS: { id: AuditCategoryFilter; label: string }[] = [
  { id: 'all', label: 'All Events' },
  { id: 'badges', label: 'Badges & Accounts' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'content', label: 'Content' },
  { id: 'opps_events', label: 'Opportunities & Events' },
  { id: 'trusted_settings', label: 'Trusted & Settings' },
  { id: 'anonymous_reveals', label: 'Anon Reveals' },
];

function formatTimestampLabel(value: unknown): string {
  const ms = extractTimestampMs(value);
  if (!ms) return 'Pending timestamp';
  return new Date(ms).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function matchesAuditFilter(
  entry: UnifiedAuditEntry,
  filter: AuditCategoryFilter
): boolean {
  if (filter === 'all') return true;
  if (filter === 'badges') return entry.kind === 'badge';
  if (filter === 'anonymous_reveals') return entry.kind === 'anonymous_reveal';
  if (entry.kind !== 'admin') return false;

  const action = entry.data.action;
  if (filter === 'marketplace') {
    return action.startsWith('marketplace_');
  }
  if (filter === 'content') {
    return (
      action === 'post_deleted' ||
      action === 'anonymous_post_deleted' ||
      action === 'post_comment_deleted' ||
      action === 'anonymous_comment_deleted' ||
      action === 'post_pinned' ||
      action === 'post_unpinned' ||
      action === 'post_official_toggled'
    );
  }
  if (filter === 'opps_events') {
    return action.startsWith('opportunity_') || action.startsWith('event_');
  }
  if (filter === 'trusted_settings') {
    return (
      action.startsWith('trusted_contact_') ||
      action === 'settings_updated' ||
      action === 'announcement_broadcast'
    );
  }
  return true;
}

export const AdminAuditLogTab: React.FC<AdminAuditLogTabProps> = ({
  entries,
  loading,
}) => {
  const [filter, setFilter] = useState<AuditCategoryFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredEntries = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return entries.filter((entry) => {
      if (!matchesAuditFilter(entry, filter)) return false;
      if (!term) return true;
      const haystack =
        entry.kind === 'badge'
          ? [
              entry.data.action,
              entry.data.targetUsername ?? '',
              entry.data.targetUid,
              entry.data.performedByUid,
              entry.data.reason ?? '',
            ]
          : entry.kind === 'admin'
          ? [
              entry.data.action,
              entry.data.targetCollection,
              entry.data.targetId,
              entry.data.targetLabel ?? '',
              entry.data.performedByUid,
              entry.data.details ?? '',
            ]
          : [
              entry.data.targetEntryId,
              entry.data.revealedByUid,
              entry.data.reason,
            ];
      return haystack.join(' ').toLowerCase().includes(term);
    });
  }, [entries, filter, searchQuery]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setFilter(opt.id)}
            className={`min-h-[36px] rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
              filter === opt.id
                ? 'border-[#0B1A2E] bg-[#0B1A2E] text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search audit entries by target, action, actor UID, or reason..."
          className="block min-h-[42px] w-full rounded-xl border border-slate-300 py-2 pr-3 pl-9 text-sm text-[#0B1A2E] focus:border-[#1E88E5]"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-slate-600">
          <Loader2
            className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
            aria-hidden="true"
          />
          Loading immutable platform audit log...
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center">
          <ClipboardList
            className="mx-auto mb-2 h-6 w-6 text-slate-400"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold text-[#0B1A2E]">
            No audit records match your filter
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Badge updates, suspensions, marketplace reviews, content deletions,
            and settings changes appear here automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredEntries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-xl border border-slate-200 bg-white p-3.5 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-[#0B1A2E]">
                  {entry.kind === 'anonymous_reveal'
                    ? `Anonymous Safety Lookup — ${entry.data.targetEntryId}`
                    : formatAdminAuditActionLabel(entry.data.action)}
                </span>
                <span className="text-slate-500">
                  {formatTimestampLabel(entry.createdAt)}
                </span>
              </div>

              {entry.kind === 'badge' ? (
                <>
                  <p className="mt-1 text-slate-600">
                    Member:{' '}
                    <strong>
                      {entry.data.targetUsername
                        ? `@${entry.data.targetUsername}`
                        : entry.data.targetUid}
                    </strong>{' '}
                    · Role: <strong>{entry.data.previousRole}</strong> -&gt;{' '}
                    <strong>{entry.data.nextRole}</strong> · By{' '}
                    <span className="uppercase">{entry.data.performedByRole}</span>{' '}
                    ({entry.data.performedByUid})
                  </p>
                  {entry.data.reason && (
                    <p className="mt-1 text-slate-700">
                      Note: {entry.data.reason}
                    </p>
                  )}
                </>
              ) : entry.kind === 'admin' ? (
                <>
                  <p className="mt-1 text-slate-600">
                    Target:{' '}
                    <strong>
                      {entry.data.targetLabel || entry.data.targetId}
                    </strong>{' '}
                    ({entry.data.targetCollection}) · By{' '}
                    <span className="uppercase">{entry.data.performedByRole}</span>{' '}
                    ({entry.data.performedByUid})
                  </p>
                  {entry.data.details && (
                    <p className="mt-1 text-slate-700">{entry.data.details}</p>
                  )}
                </>
              ) : (
                <p className="mt-1 text-slate-600">
                  Reason: {entry.data.reason} · Revealed by UID:{' '}
                  {entry.data.revealedByUid}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
