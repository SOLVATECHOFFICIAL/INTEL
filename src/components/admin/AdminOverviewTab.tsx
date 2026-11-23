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
              className="h-28 animate-pulse rounded-xl border border-slate-200 bg-slate-50"
            />
          ))}
        </div>
        <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50/70 py-14 text-sm text-slate-600">
          <Loader2
            className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
            aria-hidden="true"
          />
          Loading live Firebase analytics &amp; moderation reports...
        </div>
      </div>
    );
  }

  const { stats, recentAudits, pendingListings, pendingReports } = bundle;

  const primaryKpis = [
    {
      label: 'Total Users',
      value: stats.totalMembers,
      meta: `${stats.activeMembers.toLocaleString()} active · ${stats.suspendedMembers.toLocaleString()} suspended`,
      icon: Users,
      highlight: false,
      actionLabel: isFullAdmin ? 'Members' : undefined,
      onAction: isFullAdmin ? () => onSelectSection('members') : undefined,
    },
    {
      label: 'Active Posts',
      value: stats.totalActivePosts,
      meta: `${stats.publishedOrdinaryPosts.toLocaleString()} ordinary · ${stats.publishedAnonymousPosts.toLocaleString()} anonymous`,
      icon: FileText,
      highlight: false,
      actionLabel: 'Content',
      onAction: () => onSelectSection('content'),
    },
    {
      label: 'Flagged Reports',
      value: stats.totalFlaggedReports,
      meta: `${stats.pendingFlaggedReports.toLocaleString()} pending · ${stats.removedFlaggedReports.toLocaleString()} removed`,
      icon: Flag,
      highlight: stats.pendingFlaggedReports > 0,
      actionLabel: 'Reports Queue',
      onAction: () =>
        onSelectSection('content', { contentSubTab: 'anonymous_reports' }),
    },
    {
      label: 'Pending Approvals',
      value: stats.pendingMarketplaceApprovals,
      meta: `${stats.approvedMarketplaceListings.toLocaleString()} market live · ${stats.activeOpportunities.toLocaleString()} opps · ${stats.upcomingEvents.toLocaleString()} events`,
      icon: Clock,
      highlight: stats.pendingMarketplaceApprovals > 0,
      actionLabel: 'Marketplace',
      onAction: () => onSelectSection('marketplace'),
    },
  ];

  return (
    <div className="space-y-6">
      {/* 4 Focused KPI Summary Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {primaryKpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className={`flex flex-col justify-between rounded-xl border p-4 ${
                kpi.highlight
                  ? 'border-amber-300 bg-amber-50/40'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-500">
                  {kpi.label}
                </span>
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    kpi.highlight ? 'text-amber-700' : 'text-[#1E88E5]'
                  }`}
                  aria-hidden="true"
                />
              </div>

              <div className="mt-2.5">
                <p className="font-display text-3xl font-extrabold tracking-tight text-[#0B1A2E] tabular-nums">
                  {kpi.value.toLocaleString()}
                </p>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-slate-600">
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

      {/* D3 Visualizations: Total Users, Active Post Metrics, Flagged Content Reports */}
      <AdminD3Charts
        stats={stats}
        isFullAdmin={isFullAdmin}
        onSelectSection={onSelectSection}
      />

      {/* Actionable Queues: Flagged Reports, Pending Marketplace, Recent Activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-sm font-bold text-[#0B1A2E]">
              Flagged Content Reports Queue ({stats.pendingFlaggedReports})
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
              Triage Reports
            </button>
          </div>
          {pendingReports.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-4 text-center text-xs text-slate-500">
              No pending flagged content reports in the moderation queue.
            </p>
          ) : (
            <div className="mt-3 divide-y divide-slate-100">
              {pendingReports.slice(0, 6).map((report) => (
                <div
                  key={report.id}
                  className="flex items-start justify-between gap-3 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[#0B1A2E]">
                      {report.excerpt || 'Flagged anonymous entry'}
                    </p>
                    <p className="mt-0.5 text-slate-500">
                      {formatReportReasonLabel(report.reason)} ·{' '}
                      {report.targetType === 'anonymousPost'
                        ? 'Anonymous post'
                        : 'Anonymous comment'}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-500 tabular-nums">
                    {formatShortTime(report.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-sm font-bold text-[#0B1A2E]">
              Pending Marketplace Queue ({stats.pendingMarketplaceApprovals})
            </h3>
            <button
              type="button"
              onClick={() => onSelectSection('marketplace')}
              className="text-xs font-semibold text-[#1E88E5] hover:underline whitespace-nowrap"
            >
              Review All
            </button>
          </div>
          {pendingListings.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-4 text-center text-xs text-slate-500">
              No marketplace submissions waiting for review.
            </p>
          ) : (
            <div className="mt-3 divide-y divide-slate-100">
              {pendingListings.slice(0, 6).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[#0B1A2E]">
                      {item.title}
                    </p>
                    <p className="mt-0.5 text-slate-500">
                      {item.listingKind} · ₦{item.price.toLocaleString()} · Qty{' '}
                      <span className="tabular-nums">{item.quantity}</span>
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-500 tabular-nums">
                    {formatShortTime(item.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Audit Activity / Moderator Scope Row */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-sm font-bold text-[#0B1A2E]">
            {isFullAdmin ? 'Recent Administrative Activity' : 'Moderation Scope Notice'}
          </h3>
          {isFullAdmin && (
            <button
              type="button"
              onClick={() => onSelectSection('audit-log')}
              className="text-xs font-semibold text-[#1E88E5] hover:underline whitespace-nowrap"
            >
              Full Audit Log
            </button>
          )}
        </div>

        {!isFullAdmin ? (
          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-700">
            <p className="font-semibold text-[#0B1A2E]">
              Moderator Console Permissions
            </p>
            <p>
              You can approve or reject ordinary members&apos; pending
              marketplace submissions, triage anonymous flagged reports, and
              remove violating ordinary-member posts or replies.
            </p>
            <p className="text-slate-600">
              Verified, Moderator, and Admin content, badge management, user
              suspensions, opportunities, events, platform settings, and
              anonymous identity reveals are restricted to Supreme Admins.
            </p>
          </div>
        ) : recentAudits.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-4 text-center text-xs text-slate-500">
            No audit log entries recorded yet.
          </p>
        ) : (
          <div className="mt-3 divide-y divide-slate-100">
            {recentAudits.slice(0, 6).map((entry) => (
              <div
                key={entry.id}
                className="flex items-start justify-between gap-3 py-2.5 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-[#0B1A2E]">
                    {entry.kind === 'anonymous_reveal'
                      ? `Anonymous safety lookup (${entry.data.targetEntryId})`
                      : formatAdminAuditActionLabel(entry.data.action)}
                  </p>
                  <p className="truncate text-slate-500">
                    {entry.kind === 'badge'
                      ? entry.data.targetUsername
                        ? `@${entry.data.targetUsername} -> ${entry.data.nextRole}`
                        : entry.data.targetUid
                      : entry.kind === 'admin'
                      ? entry.data.targetLabel || entry.data.targetId
                      : entry.data.reason}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-slate-500 tabular-nums">
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
