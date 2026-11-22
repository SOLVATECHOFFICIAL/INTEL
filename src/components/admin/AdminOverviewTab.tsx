import React from 'react';
import {
  ArrowRight,
  Award,
  Briefcase,
  Calendar,
  Clock,
  EyeOff,
  FileText,
  Loader2,
  Shield,
  ShoppingBag,
  Users,
} from 'lucide-react';
import type { AdminOverviewBundle } from '../../services/adminDashboard';
import {
  formatAdminAuditActionLabel,
  type AdminDashboardSectionId,
} from '../../utils/adminPermissions';
import { extractTimestampMs } from '../../utils/contextualSearch';

interface AdminOverviewTabProps {
  bundle: AdminOverviewBundle | null;
  loading: boolean;
  isFullAdmin: boolean;
  onSelectSection: (sectionId: AdminDashboardSectionId) => void;
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

export const AdminOverviewTab: React.FC<AdminOverviewTabProps> = ({
  bundle,
  loading,
  isFullAdmin,
  onSelectSection,
}) => {
  if (loading || !bundle) {
    return (
      <div className="flex items-center justify-center py-14 text-sm text-slate-600">
        <Loader2
          className="mr-2 h-4 w-4 animate-spin text-[#1E88E5]"
          aria-hidden="true"
        />
        Loading live Firebase platform statistics...
      </div>
    );
  }

  const { stats, recentAudits, pendingListings } = bundle;
  const totalMembers = Math.max(stats.totalMembers, 1);
  const totalMarketplace = Math.max(stats.totalMarketplaceListings, 1);

  const metricCards = [
    {
      label: 'Registered Members',
      value: stats.totalMembers,
      sub: `${stats.suspendedMembers} suspended`,
      icon: Users,
      section: 'members' as AdminDashboardSectionId,
    },
    {
      label: 'Verified Members',
      value: stats.verifiedMembers,
      sub: 'Green badge holders',
      icon: Award,
      section: 'badges' as AdminDashboardSectionId,
    },
    {
      label: 'Moderators',
      value: stats.moderators,
      sub: 'Red badge team',
      icon: Shield,
      section: 'badges' as AdminDashboardSectionId,
    },
    {
      label: 'Ordinary Members',
      value: stats.ordinaryMembers,
      sub: 'Standard campus tier',
      icon: Users,
      section: 'members' as AdminDashboardSectionId,
    },
    {
      label: 'Published Posts',
      value: stats.publishedOrdinaryPosts,
      sub: 'Ordinary community feed',
      icon: FileText,
      section: 'content' as AdminDashboardSectionId,
    },
    {
      label: 'Anonymous Posts',
      value: stats.publishedAnonymousPosts,
      sub: 'The Unfiltered threads',
      icon: EyeOff,
      section: 'content' as AdminDashboardSectionId,
    },
    {
      label: 'Marketplace Listings',
      value: stats.totalMarketplaceListings,
      sub: `${stats.approvedMarketplaceListings} live now`,
      icon: ShoppingBag,
      section: 'marketplace' as AdminDashboardSectionId,
    },
    {
      label: 'Pending Approvals',
      value: stats.pendingMarketplaceApprovals,
      sub: 'Needs mod/admin review',
      icon: Clock,
      highlight: stats.pendingMarketplaceApprovals > 0,
      section: 'marketplace' as AdminDashboardSectionId,
    },
    {
      label: 'Opportunities',
      value: stats.totalOpportunities,
      sub: `${stats.activeOpportunities} active`,
      icon: Briefcase,
      section: 'opportunities' as AdminDashboardSectionId,
    },
    {
      label: 'Campus Events',
      value: stats.totalEvents,
      sub: `${stats.upcomingEvents} upcoming`,
      icon: Calendar,
      section: 'events' as AdminDashboardSectionId,
    },
  ];

  const memberBars = [
    {
      label: 'Ordinary Members',
      count: stats.ordinaryMembers,
      color: 'bg-[#0B1A2E]',
    },
    {
      label: 'Verified Members',
      count: stats.verifiedMembers,
      color: 'bg-emerald-600',
    },
    {
      label: 'Moderators',
      count: stats.moderators,
      color: 'bg-red-600',
    },
    {
      label: 'Supreme Admins',
      count: stats.supremeAdmins,
      color: 'bg-purple-700',
    },
  ];

  const marketplaceBars = [
    {
      label: 'Pending Approval',
      count: stats.pendingMarketplaceApprovals,
      color: 'bg-amber-500',
    },
    {
      label: 'Approved & Live',
      count: stats.approvedMarketplaceListings,
      color: 'bg-emerald-600',
    },
    {
      label: 'Sold Out',
      count: stats.soldMarketplaceListings,
      color: 'bg-[#1E88E5]',
    },
    {
      label: 'Expired',
      count: stats.expiredMarketplaceListings,
      color: 'bg-slate-400',
    },
    {
      label: 'Rejected',
      count: stats.rejectedMarketplaceListings,
      color: 'bg-red-600',
    },
  ];

  return (
    <div className="space-y-6">
      {/* 10 Real Metric Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {metricCards.map((card) => {
          const Icon = card.icon;
          const canJump =
            isFullAdmin ||
            card.section === 'marketplace' ||
            card.section === 'content';
          return (
            <div
              key={card.label}
              className={`flex flex-col justify-between rounded-xl border p-3.5 sm:p-4 ${
                card.highlight
                  ? 'border-amber-300 bg-amber-50/60'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  {card.label}
                </span>
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    card.highlight ? 'text-amber-700' : 'text-[#1E88E5]'
                  }`}
                  aria-hidden="true"
                />
              </div>
              <div className="mt-2">
                <p className="font-display text-2xl font-extrabold text-[#0B1A2E] tabular-nums">
                  {card.value.toLocaleString()}
                </p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-600">{card.sub}</span>
                  {canJump && (
                    <button
                      type="button"
                      onClick={() => onSelectSection(card.section)}
                      aria-label={`Open ${card.label}`}
                      className="inline-flex items-center text-[11px] font-semibold text-[#1E88E5] hover:underline"
                    >
                      Open
                      <ArrowRight className="ml-0.5 h-3 w-3" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Distribution Analytics */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="font-display text-sm font-bold text-[#0B1A2E]">
            Community Membership Tiers
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Distribution of visible registered accounts across authority tiers.
          </p>
          <div className="mt-4 space-y-3">
            {memberBars.map((bar) => {
              const pct = Math.round((bar.count / totalMembers) * 100);
              return (
                <div key={bar.label}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[#0B1A2E]">
                      {bar.label}
                    </span>
                    <span className="font-semibold text-slate-600 tabular-nums">
                      {bar.count} ({pct}%)
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${bar.color}`}
                      style={{ width: `${Math.min(100, Math.max(bar.count > 0 ? 3 : 0, pct))}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="font-display text-sm font-bold text-[#0B1A2E]">
            Marketplace Pipeline &amp; Lifecycle
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Real listing states with automated 7-day expiry classification.
          </p>
          <div className="mt-4 space-y-3">
            {marketplaceBars.map((bar) => {
              const pct = Math.round((bar.count / totalMarketplace) * 100);
              return (
                <div key={bar.label}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[#0B1A2E]">
                      {bar.label}
                    </span>
                    <span className="font-semibold text-slate-600 tabular-nums">
                      {bar.count} ({pct}%)
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${bar.color}`}
                      style={{ width: `${Math.min(100, Math.max(bar.count > 0 ? 3 : 0, pct))}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Recent Activity / Pending Queue */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-sm font-bold text-[#0B1A2E]">
              Pending Marketplace Queue ({stats.pendingMarketplaceApprovals})
            </h2>
            <button
              type="button"
              onClick={() => onSelectSection('marketplace')}
              className="text-xs font-semibold text-[#1E88E5] hover:underline"
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
                    <p className="text-slate-500">
                      {item.listingKind} · ₦{item.price.toLocaleString()} · Qty{' '}
                      <span className="tabular-nums">{item.quantity}</span>
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-500">
                    {formatShortTime(item.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-sm font-bold text-[#0B1A2E]">
              {isFullAdmin ? 'Recent Administrative Activity' : 'Moderation Scope Notice'}
            </h2>
            {isFullAdmin && (
              <button
                type="button"
                onClick={() => onSelectSection('audit-log')}
                className="text-xs font-semibold text-[#1E88E5] hover:underline"
              >
                Full Audit Log
              </button>
            )}
          </div>

          {!isFullAdmin ? (
            <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs leading-relaxed text-slate-700">
              <p className="font-semibold text-[#0B1A2E]">
                Moderator Console Permissions
              </p>
              <p>
                You can approve or reject ordinary members&apos; pending
                marketplace submissions and remove violating ordinary-member
                posts or replies.
              </p>
              <p>
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
                  <span className="shrink-0 text-[11px] text-slate-500">
                    {formatShortTime(entry.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
