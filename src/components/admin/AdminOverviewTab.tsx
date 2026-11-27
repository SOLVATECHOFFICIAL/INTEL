import React from 'react';
import {
  ArrowRight,
  Clock,
  FileText,
  Flag,
  Loader2,
  Users,
} from 'lucide-react';
import type { AdminOverviewBundle } from '../../services/adminDashboard';
import {
  formatAdminAuditActionLabel,
  type AdminDashboardSectionId,
} from '../../utils/adminPermissions';
import { extractTimestampMs } from '../../utils/contextualSearch';
import { AdminD3Charts } from './AdminD3Charts';

type ContentSubTabId =
  | 'ordinary_posts'
  | 'anonymous_posts'
  | 'post_comments'
  | 'anonymous_comments'
  | 'anonymous_reports';

interface AdminOverviewTabProps {
  bundle: AdminOverviewBundle | null;
  loading: boolean;
  isFullAdmin: boolean;
  onSelectSection: (
    sectionId: AdminDashboardSectionId,
    options?: { contentSubTab?: ContentSubTabId }
  ) => void;
}

function formatShortTime(value: unknown): string {
  const ms = extractTimestampMs(value);
  if (!ms) return 'Pending';
  return new Date(ms).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatReportReasonLabel(reason: string): string {
  switch (reason) {
    case 'harassment':
      return 'Harassment';
    case 'hate_speech':
      return 'Hate speech';
    case 'privacy_leak':
      return 'Privacy leak';
    case 'misinformation':
      return 'Misinformation';
    case 'spam':
      return 'Spam';
    default:
      return 'Other';
  }
}

export const AdminOverviewTab: React.FC<AdminOverviewTabProps> = ({
  bundle,
  loading,
  isFullAdmin,
  onSelectSection,
}) => {
  if (loading || !bundle) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((slot) => (
            <div
              key={slot}
              className="h-28 animate-pulse rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60"
            />
          ))}
        </div>
        <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50/70 py-14 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
          <Loader2
            className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
            aria-hidden="true"
          />
          Loading campus metrics...
        </div>
      </div>
    );
  }

  const { stats, recentAudits, pendingListings, pendingReports } = bundle;

  const primaryKpis = [
    {
      label: 'Members',
      value: stats.totalMembers,
      meta: `${stats.activeMembers.toLocaleString()} active · ${stats.suspendedMembers.toLocaleString()} suspended`,
      icon: Users,
      highlight: false,
      actionLabel: isFullAdmin ? 'Open' : undefined,
      onAction: isFullAdmin ? () => onSelectSection('members') : undefined,
    },
    {
      label: 'Live Posts',
      value: stats.totalActivePosts,
      meta: `${stats.publishedOrdinaryPosts.toLocaleString()} feed · ${stats.publishedAnonymousPosts.toLocaleString()} anonymous`,
      icon: FileText,
      highlight: false,
      actionLabel: 'Open',
      onAction: () => onSelectSection('content'),
    },
    {
      label: 'Flagged Reports',
      value: stats.totalFlaggedReports,
      meta: `${stats.pendingFlaggedReports.toLocaleString()} waiting · ${stats.removedFlaggedReports.toLocaleString()} removed`,
      icon: Flag,
      highlight: stats.pendingFlaggedReports > 0,
      actionLabel: 'Review',
      onAction: () =>
        onSelectSection('content', { contentSubTab: 'anonymous_reports' }),
    },
    {
      label: 'Pending Listings',
      value: stats.pendingMarketplaceApprovals,
      meta: `${stats.approvedMarketplaceListings.toLocaleString()} live · ${stats.activeOpportunities.toLocaleString()} opps · ${stats.upcomingEvents.toLocaleString()} events`,
      icon: Clock,
      highlight: stats.pendingMarketplaceApprovals > 0,
      actionLabel: 'Review',
      onAction: () => onSelectSection('marketplace'),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {primaryKpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className={`flex flex-col justify-between rounded-xl border p-4 ${
                kpi.highlight
                  ? 'border-amber-300 bg-amber-50/40 dark:border-amber-700/70 dark:bg-amber-950/30'
                  : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/80'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {kpi.label}
                </span>
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    kpi.highlight
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-[#1E88E5]'
                  }`}
                  aria-hidden="true"
                />
              </div>

              <div className="mt-2.5">
                <p className="font-display text-3xl font-extrabold tracking-tight text-[#0B1A2E] tabular-nums dark:text-slate-100">
                  {kpi.value.toLocaleString()}
                </p>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-slate-600 dark:text-slate-400">
                    {kpi.meta}
                  </span>
                  {kpi.actionLabel && kpi.onAction && (
                    <button
                      type="button"
                      onClick={kpi.onAction}
                      className="inline-flex shrink-0 items-center text-xs font-semibold text-[#1E88E5] hover:underline whitespace-nowrap"
                    >
                      {kpi.actionLabel}
                      <ArrowRight className="ml-0.5 h-3 w-3" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <AdminD3Charts
        stats={stats}
        isFullAdmin={isFullAdmin}
        onSelectSection={onSelectSection}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
              Reports to Review ({stats.pendingFlaggedReports})
            </h3>
            <button
              type="button"
              onClick={() =>
                onSelectSection('content', {
                  contentSubTab: 'anonymous_reports',
                })
              }
              className="text-xs font-semibold text-[#1E88E5] hover:underline whitespace-nowrap"
            >
              Open Queue
            </button>
          </div>
          {pendingReports.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
              All clear — no reports waiting right now.
            </p>
          ) : (
            <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              {pendingReports.slice(0, 6).map((report) => (
                <div
                  key={report.id}
                  className="flex items-start justify-between gap-3 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[#0B1A2E] dark:text-slate-100">
                      {report.excerpt || 'Flagged anonymous entry'}
                    </p>
                    <p className="mt-0.5 text-slate-500 dark:text-slate-400">
                      {formatReportReasonLabel(report.reason)} ·{' '}
                      {report.targetType === 'anonymousPost'
                        ? 'Anonymous post'
                        : 'Anonymous reply'}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                    {formatShortTime(report.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
              Marketplace Waiting Approval ({stats.pendingMarketplaceApprovals})
            </h3>
            <button
              type="button"
              onClick={() => onSelectSection('marketplace')}
              className="text-xs font-semibold text-[#1E88E5] hover:underline whitespace-nowrap"
            >
              Open Queue
            </button>
          </div>
          {pendingListings.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
              No marketplace items waiting right now.
            </p>
          ) : (
            <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              {pendingListings.slice(0, 6).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[#0B1A2E] dark:text-slate-100">
                      {item.title}
                    </p>
                    <p className="mt-0.5 text-slate-500 dark:text-slate-400">
                      {item.listingKind} · ₦{item.price.toLocaleString()} · Qty{' '}
                      <span className="tabular-nums">{item.quantity}</span>
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                    {formatShortTime(item.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/80">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-sm font-bold text-[#0B1A2E] dark:text-slate-100">
            {isFullAdmin ? 'Recent Activity' : 'Moderator Guide'}
          </h3>
          {isFullAdmin && (
            <button
              type="button"
              onClick={() => onSelectSection('audit-log')}
              className="text-xs font-semibold text-[#1E88E5] hover:underline whitespace-nowrap"
            >
              View All Activity
            </button>
          )}
        </div>

        {!isFullAdmin ? (
          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-700 dark:border-slate-800 dark:text-slate-300">
            <p className="font-semibold text-[#0B1A2E] dark:text-slate-100">
              What you can do here
            </p>
            <p>
              Approve or reject pending Marketplace items from regular members,
              review flagged reports, and remove rule-breaking posts or replies.
            </p>
            <p className="text-slate-600 dark:text-slate-400">
              Badges, member suspensions, events, opportunities, and site settings
              are handled by Supreme Admins.
            </p>
          </div>
        ) : recentAudits.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
            No recent activity recorded yet.
          </p>
        ) : (
          <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {recentAudits.slice(0, 6).map((entry) => (
              <div
                key={entry.id}
                className="flex items-start justify-between gap-3 py-2.5 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-[#0B1A2E] dark:text-slate-100">
                    {entry.kind === 'anonymous_reveal'
                      ? `Anonymous safety lookup (${entry.data.targetEntryId})`
                      : formatAdminAuditActionLabel(entry.data.action)}
                  </p>
                  <p className="truncate text-slate-500 dark:text-slate-400">
                    {entry.kind === 'badge'
                      ? entry.data.targetUsername
                        ? `@${entry.data.targetUsername} -> ${entry.data.nextRole}`
                        : entry.data.targetUid
                      : entry.kind === 'admin'
                      ? entry.data.targetLabel || entry.data.targetId
                      : entry.data.reason}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                  {formatShortTime(entry.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
