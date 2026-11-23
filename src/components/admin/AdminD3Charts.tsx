import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { ArrowRight } from 'lucide-react';
import type { AnonymousReportReason } from '../../types/database';
import type {
  AdminDashboardSectionId,
  PlatformOverviewStats,
} from '../../utils/adminPermissions';

type ContentSubTabId =
  | 'ordinary_posts'
  | 'anonymous_posts'
  | 'post_comments'
  | 'anonymous_comments'
  | 'anonymous_reports';

interface AdminD3ChartsProps {
  stats: PlatformOverviewStats;
  isFullAdmin: boolean;
  onSelectSection: (
    sectionId: AdminDashboardSectionId,
    options?: { contentSubTab?: ContentSubTabId }
  ) => void;
}

interface ChartDatum {
  key: string;
  label: string;
  shortLabel?: string;
  value: number;
  color: string;
  section?: AdminDashboardSectionId;
  contentSubTab?: ContentSubTabId;
}

function useContainerWidth(
  ref: React.RefObject<HTMLDivElement | null>,
  fallbackWidth = 420
): number {
  const [width, setWidth] = useState<number>(fallbackWidth);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const updateWidth = () => {
      const measured = Math.floor(el.getBoundingClientRect().width);
      if (measured > 0) {
        setWidth((prev) => (prev === measured ? prev : measured));
      }
    };

    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

const REPORT_REASON_META: ReadonlyArray<{
  key: AnonymousReportReason;
  label: string;
  shortLabel: string;
  color: string;
}> = [
  { key: 'harassment', label: 'Harassment', shortLabel: 'Harassment', color: '#DC2626' },
  { key: 'hate_speech', label: 'Hate Speech', shortLabel: 'Hate Speech', color: '#B91C1C' },
  { key: 'privacy_leak', label: 'Privacy Leak', shortLabel: 'Privacy', color: '#D97706' },
  { key: 'misinformation', label: 'Misinformation', shortLabel: 'Misinfo', color: '#1E88E5' },
  { key: 'spam', label: 'Spam', shortLabel: 'Spam', color: '#0B1A2E' },
  { key: 'other', label: 'Other', shortLabel: 'Other', color: '#64748B' },
];

export const TotalUsersD3Chart: React.FC<{
  stats: PlatformOverviewStats;
  isFullAdmin: boolean;
  onSelectSection: AdminD3ChartsProps['onSelectSection'];
}> = ({ stats, isFullAdmin, onSelectSection }) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const slices = useMemo<ChartDatum[]>(
    () => [
      {
        key: 'ordinary',
        label: 'Ordinary Members',
        value: stats.ordinaryMembers,
        color: '#0B1A2E',
      },
      {
        key: 'verified',
        label: 'Verified Members',
        value: stats.verifiedMembers,
        color: '#1E88E5',
      },
      {
        key: 'moderator',
        label: 'Moderators',
        value: stats.moderators,
        color: '#16A34A',
      },
      {
        key: 'supreme_admin',
        label: 'Supreme Admins',
        value: stats.supremeAdmins,
        color: '#0F766E',
      },
    ],
    [
      stats.ordinaryMembers,
      stats.verifiedMembers,
      stats.moderators,
      stats.supremeAdmins,
    ]
  );

  const totalTierCount = useMemo(
    () => slices.reduce((sum, item) => sum + item.value, 0),
    [slices]
  );

  const activeSlice = useMemo(
    () => slices.find((item) => item.key === hoveredKey) ?? null,
    [slices, hoveredKey]
  );

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const size = 216;
    const outerRadius = 90;
    const innerRadius = 56;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const g = svg
      .append('g')
      .attr('transform', `translate(${size / 2}, ${size / 2})`);

    const nonZero = slices.filter((d) => d.value > 0);
    if (nonZero.length === 0) {
      g.append('circle')
        .attr('r', (outerRadius + innerRadius) / 2)
        .attr('fill', 'none')
        .attr('stroke', '#E2E8F0')
        .attr('stroke-width', outerRadius - innerRadius);
      return;
    }

    const pie = d3
      .pie<ChartDatum>()
      .value((d) => d.value)
      .sort(null)
      .padAngle(nonZero.length > 1 ? 0.025 : 0);

    const arc = d3
      .arc<d3.PieArcDatum<ChartDatum>>()
      .innerRadius(innerRadius)
      .outerRadius((d) => (d.data.key === hoveredKey ? outerRadius + 5 : outerRadius))
      .cornerRadius(4);

    g.selectAll('path')
      .data(pie(nonZero))
      .join('path')
      .attr('d', (d) => arc(d) ?? '')
      .attr('fill', (d) => d.data.color)
      .attr('opacity', (d) =>
        hoveredKey && hoveredKey !== d.data.key ? 0.42 : 1
      )
      .style('cursor', 'pointer')
      .style('transition', 'opacity 150ms ease')
      .on('mouseenter', (_event, d) => setHoveredKey(d.data.key))
      .on('mouseleave', () => setHoveredKey(null))
      .append('title')
      .text((d) => `${d.data.label}: ${d.data.value.toLocaleString()}`);
  }, [slices, hoveredKey]);

  const pctDenom = Math.max(totalTierCount, 1);

  return (
    <section
      aria-labelledby="d3-users-heading"
      className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3
            id="d3-users-heading"
            className="font-display text-sm font-bold text-[#0B1A2E]"
          >
            Total User Counts &amp; Roles
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            <span className="font-semibold text-[#0B1A2E] tabular-nums">
              {stats.totalMembers.toLocaleString()}
            </span>{' '}
            total ·{' '}
            <span className="text-emerald-700 tabular-nums">
              {stats.activeMembers.toLocaleString()} active
            </span>{' '}
            ·{' '}
            <span className="text-red-700 tabular-nums">
              {stats.suspendedMembers.toLocaleString()} suspended
            </span>
          </p>
        </div>
        {isFullAdmin && (
          <button
            type="button"
            onClick={() => onSelectSection('members')}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#1E88E5] hover:underline whitespace-nowrap"
          >
            Directory
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row">
        <div className="relative h-[216px] w-[216px] shrink-0">
          <svg
            ref={svgRef}
            width={216}
            height={216}
            viewBox="0 0 216 216"
            role="img"
            aria-label={`User role breakdown chart for ${stats.totalMembers} total users`}
            className="block"
          />
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="font-display text-2xl font-extrabold text-[#0B1A2E] tabular-nums">
              {(activeSlice ? activeSlice.value : stats.totalMembers).toLocaleString()}
            </span>
            <span className="mt-0.5 max-w-[96px] truncate text-[11px] font-medium text-slate-500">
              {activeSlice ? activeSlice.label : 'Total Users'}
            </span>
          </div>
        </div>

        <div className="w-full min-w-0 flex-1 divide-y divide-slate-100">
          {slices.map((slice) => {
            const pct = Math.round((slice.value / pctDenom) * 100);
            const isHovered = hoveredKey === slice.key;
            return (
              <button
                key={slice.key}
                type="button"
                onMouseEnter={() => setHoveredKey(slice.key)}
                onMouseLeave={() => setHoveredKey(null)}
                onFocus={() => setHoveredKey(slice.key)}
                onBlur={() => setHoveredKey(null)}
                onClick={() => {
                  if (isFullAdmin) {
                    onSelectSection(slice.key === 'ordinary' ? 'members' : 'badges');
                  }
                }}
                className={`flex w-full items-center justify-between gap-3 py-2.5 text-left text-xs transition-colors ${
                  isHovered ? 'bg-slate-50/90' : ''
                }`}
              >
                <span className="flex min-w-0 items-center gap-2 font-medium text-[#0B1A2E]">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: slice.color }}
                  />
                  <span className="truncate">{slice.label}</span>
                </span>
                <span className="shrink-0 font-mono text-xs font-semibold text-slate-700 tabular-nums">
                  {slice.value.toLocaleString()}{' '}
                  <span className="text-slate-400">({pct}%)</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export const ActivePostMetricsD3Chart: React.FC<{
  stats: PlatformOverviewStats;
  isFullAdmin: boolean;
  onSelectSection: AdminD3ChartsProps['onSelectSection'];
}> = ({ stats, isFullAdmin, onSelectSection }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const width = useContainerWidth(containerRef, 460);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const items = useMemo<ChartDatum[]>(
    () => [
      {
        key: 'ordinary_posts',
        label: 'Ordinary Posts',
        shortLabel: 'Feed Posts',
        value: stats.publishedOrdinaryPosts,
        color: '#0B1A2E',
        section: 'content',
        contentSubTab: 'ordinary_posts',
      },
      {
        key: 'anonymous_posts',
        label: 'Anonymous Posts',
        shortLabel: 'Unfiltered',
        value: stats.publishedAnonymousPosts,
        color: '#1E88E5',
        section: 'content',
        contentSubTab: 'anonymous_posts',
      },
      {
        key: 'live_marketplace',
        label: 'Live Marketplace',
        shortLabel: 'Market Live',
        value: stats.approvedMarketplaceListings,
        color: '#16A34A',
        section: 'marketplace',
      },
      {
        key: 'active_opps',
        label: 'Active Opportunities',
        shortLabel: 'Opps',
        value: stats.activeOpportunities,
        color: '#0284C7',
        section: isFullAdmin ? 'opportunities' : undefined,
      },
      {
        key: 'upcoming_events',
        label: 'Upcoming Events',
        shortLabel: 'Events',
        value: stats.upcomingEvents,
        color: '#D97706',
        section: isFullAdmin ? 'events' : undefined,
      },
    ],
    [
      stats.publishedOrdinaryPosts,
      stats.publishedAnonymousPosts,
      stats.approvedMarketplaceListings,
      stats.activeOpportunities,
      stats.upcomingEvents,
      isFullAdmin,
    ]
  );

  const hoveredItem = useMemo(
    () => items.find((item) => item.key === hoveredKey) ?? null,
    [items, hoveredKey]
  );

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svgWidth = Math.max(width, 280);
    const svgHeight = 236;
    const margin = { top: 20, right: 12, bottom: 38, left: 38 };
    const innerWidth = Math.max(svgWidth - margin.left - margin.right, 160);
    const innerHeight = svgHeight - margin.top - margin.bottom;

    const maxVal = Math.max(d3.max(items, (d) => d.value) ?? 0, 4);

    const x = d3
      .scaleBand<string>()
      .domain(items.map((d) => d.key))
      .range([0, innerWidth])
      .padding(0.32);

    const y = d3.scaleLinear().domain([0, maxVal]).nice(4).range([innerHeight, 0]);

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    const gridTicks = y.ticks(4);
    g.append('g')
      .selectAll('line')
      .data(gridTicks)
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d) => y(d))
      .attr('y2', (d) => y(d))
      .attr('stroke', '#E2E8F0')
      .attr('stroke-dasharray', '3,3');

    const yAxis = d3
      .axisLeft(y)
      .ticks(4)
      .tickSize(0)
      .tickFormat((v) => String(v));

    g.append('g')
      .call(yAxis)
      .call((axisG) => axisG.select('.domain').remove())
      .selectAll('text')
      .attr('fill', '#64748B')
      .attr('font-size', '11px')
      .style('font-variant-numeric', 'tabular-nums');

    const xAxis = d3
      .axisBottom(x)
      .tickSize(0)
      .tickFormat((key) => {
        const found = items.find((d) => d.key === key);
        return svgWidth < 400
          ? found?.shortLabel ?? key
          : found?.shortLabel ?? found?.label ?? key;
      });

    g.append('g')
      .attr('transform', `translate(0, ${innerHeight})`)
      .call(xAxis)
      .call((axisG) => axisG.select('.domain').attr('stroke', '#CBD5E1'))
      .selectAll('text')
      .attr('dy', '1.15em')
      .attr('fill', '#334155')
      .attr('font-size', '11px')
      .attr('font-weight', '600');

    g.selectAll('rect.active-bar')
      .data(items)
      .join('rect')
      .attr('class', 'active-bar')
      .attr('x', (d) => x(d.key) ?? 0)
      .attr('y', (d) => y(d.value))
      .attr('width', x.bandwidth())
      .attr('height', (d) => Math.max(0, innerHeight - y(d.value)))
      .attr('rx', 5)
      .attr('fill', (d) => d.color)
      .attr('opacity', (d) => (hoveredKey && hoveredKey !== d.key ? 0.55 : 1))
      .style('cursor', (d) => (d.section ? 'pointer' : 'default'))
      .style('transition', 'opacity 150ms ease')
      .on('mouseenter', (_event, d) => setHoveredKey(d.key))
      .on('mouseleave', () => setHoveredKey(null))
      .on('click', (_event, d) => {
        if (d.section) {
          onSelectSection(
            d.section,
            d.contentSubTab ? { contentSubTab: d.contentSubTab } : undefined
          );
        }
      })
      .append('title')
      .text((d) => `${d.label}: ${d.value.toLocaleString()}`);

    g.selectAll('text.bar-value')
      .data(items)
      .join('text')
      .attr('class', 'bar-value')
      .attr('x', (d) => (x(d.key) ?? 0) + x.bandwidth() / 2)
      .attr('y', (d) => Math.max(y(d.value) - 6, 10))
      .attr('text-anchor', 'middle')
      .attr('fill', '#0B1A2E')
      .attr('font-size', '11px')
      .attr('font-weight', '700')
      .style('font-variant-numeric', 'tabular-nums')
      .text((d) => d.value.toLocaleString());
  }, [items, width, hoveredKey, onSelectSection]);

  return (
    <section
      aria-labelledby="d3-posts-heading"
      className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3
            id="d3-posts-heading"
            className="font-display text-sm font-bold text-[#0B1A2E]"
          >
            Active Post &amp; Campus Content Metrics
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {hoveredItem ? (
              <>
                <span className="font-semibold text-[#0B1A2E]">
                  {hoveredItem.label}:
                </span>{' '}
                <span className="font-mono font-semibold text-[#1E88E5] tabular-nums">
                  {hoveredItem.value.toLocaleString()}
                </span>
              </>
            ) : (
              <>
                <span className="font-semibold text-[#0B1A2E] tabular-nums">
                  {stats.totalActivePosts.toLocaleString()}
                </span>{' '}
                active posts ·{' '}
                <span className="tabular-nums">
                  {stats.publishedOrdinaryPosts.toLocaleString()} ordinary
                </span>{' '}
                ·{' '}
                <span className="tabular-nums">
                  {stats.publishedAnonymousPosts.toLocaleString()} anonymous
                </span>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onSelectSection('content')}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#1E88E5] hover:underline whitespace-nowrap"
        >
          Manage Posts
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <div ref={containerRef} className="mt-3 w-full">
        <svg
          ref={svgRef}
          width={Math.max(width, 280)}
          height={236}
          viewBox={`0 0 ${Math.max(width, 280)} 236`}
          role="img"
          aria-label="Bar chart showing active community posts, anonymous posts, marketplace listings, opportunities, and upcoming events"
          className="block w-full overflow-visible"
        />
      </div>
    </section>
  );
};

export const FlaggedReportsD3Chart: React.FC<{
  stats: PlatformOverviewStats;
  onSelectSection: AdminD3ChartsProps['onSelectSection'];
}> = ({ stats, onSelectSection }) => {
  const donutRef = useRef<SVGSVGElement | null>(null);
  const barContainerRef = useRef<HTMLDivElement | null>(null);
  const barSvgRef = useRef<SVGSVGElement | null>(null);
  const barWidth = useContainerWidth(barContainerRef, 460);
  const [hoveredReason, setHoveredReason] = useState<string | null>(null);

  const statusSlices = useMemo<ChartDatum[]>(
    () => [
      {
        key: 'pending',
        label: 'Pending Review',
        value: stats.pendingFlaggedReports,
        color: '#D97706',
      },
      {
        key: 'reviewed_removed',
        label: 'Removed',
        value: stats.removedFlaggedReports,
        color: '#DC2626',
      },
      {
        key: 'dismissed',
        label: 'Dismissed',
        value: stats.dismissedFlaggedReports,
        color: '#64748B',
      },
    ],
    [
      stats.pendingFlaggedReports,
      stats.removedFlaggedReports,
      stats.dismissedFlaggedReports,
    ]
  );

  const reasonData = useMemo<ChartDatum[]>(
    () =>
      REPORT_REASON_META.map((meta) => ({
        key: meta.key,
        label: meta.label,
        shortLabel: meta.shortLabel,
        value: stats.flaggedReportsByReason[meta.key] ?? 0,
        color: meta.color,
      })),
    [stats.flaggedReportsByReason]
  );

  useEffect(() => {
    const svgEl = donutRef.current;
    if (!svgEl) return;

    const size = 180;
    const outerRadius = 74;
    const innerRadius = 48;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const g = svg
      .append('g')
      .attr('transform', `translate(${size / 2}, ${size / 2})`);

    const nonZero = statusSlices.filter((d) => d.value > 0);
    if (nonZero.length === 0) {
      g.append('circle')
        .attr('r', (outerRadius + innerRadius) / 2)
        .attr('fill', 'none')
        .attr('stroke', '#E2E8F0')
        .attr('stroke-width', outerRadius - innerRadius);
      return;
    }

    const pie = d3
      .pie<ChartDatum>()
      .value((d) => d.value)
      .sort(null)
      .padAngle(nonZero.length > 1 ? 0.03 : 0);

    const arc = d3
      .arc<d3.PieArcDatum<ChartDatum>>()
      .innerRadius(innerRadius)
      .outerRadius(outerRadius)
      .cornerRadius(4);

    g.selectAll('path')
      .data(pie(nonZero))
      .join('path')
      .attr('d', (d) => arc(d) ?? '')
      .attr('fill', (d) => d.data.color)
      .append('title')
      .text((d) => `${d.data.label}: ${d.data.value.toLocaleString()}`);
  }, [statusSlices]);

  useEffect(() => {
    const svgEl = barSvgRef.current;
    if (!svgEl) return;

    const svgWidth = Math.max(barWidth, 260);
    const svgHeight = 204;
    const margin = { top: 8, right: 36, bottom: 24, left: 96 };
    const innerWidth = Math.max(svgWidth - margin.left - margin.right, 100);
    const innerHeight = svgHeight - margin.top - margin.bottom;

    const maxVal = Math.max(d3.max(reasonData, (d) => d.value) ?? 0, 3);

    const y = d3
      .scaleBand<string>()
      .domain(reasonData.map((d) => d.key))
      .range([0, innerHeight])
      .padding(0.32);

    const x = d3.scaleLinear().domain([0, maxVal]).nice(3).range([0, innerWidth]);

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    const xTicks = x.ticks(3);
    g.append('g')
      .selectAll('line')
      .data(xTicks)
      .join('line')
      .attr('x1', (d) => x(d))
      .attr('x2', (d) => x(d))
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', '#E2E8F0')
      .attr('stroke-dasharray', '3,3');

    g.append('g')
      .attr('transform', `translate(0, ${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(3)
          .tickSize(0)
          .tickFormat((v) => String(v))
      )
      .call((axisG) => axisG.select('.domain').attr('stroke', '#CBD5E1'))
      .selectAll('text')
      .attr('dy', '1em')
      .attr('fill', '#64748B')
      .attr('font-size', '11px')
      .style('font-variant-numeric', 'tabular-nums');

    g.append('g')
      .call(
        d3
          .axisLeft(y)
          .tickSize(0)
          .tickFormat((key) => reasonData.find((d) => d.key === key)?.label ?? key)
      )
      .call((axisG) => axisG.select('.domain').remove())
      .selectAll('text')
      .attr('fill', '#334155')
      .attr('font-size', '11px')
      .attr('font-weight', '600');

    g.selectAll('rect.reason-bar')
      .data(reasonData)
      .join('rect')
      .attr('class', 'reason-bar')
      .attr('x', 0)
      .attr('y', (d) => y(d.key) ?? 0)
      .attr('width', (d) => Math.max(0, x(d.value)))
      .attr('height', y.bandwidth())
      .attr('rx', 4)
      .attr('fill', (d) => d.color)
      .attr('opacity', (d) => (hoveredReason && hoveredReason !== d.key ? 0.5 : 1))
      .style('cursor', 'pointer')
      .style('transition', 'opacity 150ms ease')
      .on('mouseenter', (_event, d) => setHoveredReason(d.key))
      .on('mouseleave', () => setHoveredReason(null))
      .on('click', () =>
        onSelectSection('content', { contentSubTab: 'anonymous_reports' })
      )
      .append('title')
      .text((d) => `${d.label}: ${d.value.toLocaleString()} reports`);

    g.selectAll('text.reason-count')
      .data(reasonData)
      .join('text')
      .attr('class', 'reason-count')
      .attr('x', (d) => x(d.value) + 6)
      .attr('y', (d) => (y(d.key) ?? 0) + y.bandwidth() / 2 + 4)
      .attr('fill', '#0B1A2E')
      .attr('font-size', '11px')
      .attr('font-weight', '700')
      .style('font-variant-numeric', 'tabular-nums')
      .text((d) => d.value.toLocaleString());
  }, [reasonData, barWidth, hoveredReason, onSelectSection]);

  return (
    <section
      aria-labelledby="d3-reports-heading"
      className="rounded-xl border border-slate-200 bg-white p-5"
    >
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div>
          <h3
            id="d3-reports-heading"
            className="font-display text-sm font-bold text-[#0B1A2E]"
          >
            Flagged Content Reports Analytics
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            <span className="font-semibold text-[#0B1A2E] tabular-nums">
              {stats.totalFlaggedReports.toLocaleString()}
            </span>{' '}
            total ·{' '}
            <span className="font-medium text-amber-700 tabular-nums">
              {stats.pendingFlaggedReports.toLocaleString()} pending
            </span>{' '}
            ·{' '}
            <span className="tabular-nums">
              {stats.flaggedReportsByTarget.anonymousPost.toLocaleString()} posts
            </span>{' '}
            /{' '}
            <span className="tabular-nums">
              {stats.flaggedReportsByTarget.anonymousComment.toLocaleString()} comments
            </span>
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            onSelectSection('content', { contentSubTab: 'anonymous_reports' })
          }
          className="inline-flex shrink-0 items-center gap-1 self-start text-xs font-semibold text-[#1E88E5] hover:underline whitespace-nowrap sm:self-auto"
        >
          Open Reports Queue
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-center">
        <div className="flex flex-col items-center gap-4 sm:flex-row lg:col-span-5">
          <div className="relative h-[180px] w-[180px] shrink-0">
            <svg
              ref={donutRef}
              width={180}
              height={180}
              viewBox="0 0 180 180"
              role="img"
              aria-label={`Flagged report resolution status donut: ${stats.pendingFlaggedReports} pending, ${stats.removedFlaggedReports} removed, ${stats.dismissedFlaggedReports} dismissed`}
              className="block"
            />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="font-display text-2xl font-extrabold text-[#0B1A2E] tabular-nums">
                {stats.pendingFlaggedReports.toLocaleString()}
              </span>
              <span className="text-[11px] font-medium text-slate-500">
                Pending
              </span>
            </div>
          </div>

          <div className="w-full min-w-0 flex-1 divide-y divide-slate-100">
            {statusSlices.map((slice) => (
              <div
                key={slice.key}
                className="flex items-center justify-between gap-3 py-2 text-xs"
              >
                <span className="flex items-center gap-2 font-medium text-[#0B1A2E]">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: slice.color }}
                  />
                  {slice.label}
                </span>
                <span className="font-mono font-semibold text-slate-700 tabular-nums">
                  {slice.value.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-100 pt-4 lg:col-span-7 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-semibold text-[#0B1A2E]">
              Reports by Violation Category
            </span>
            <span className="text-slate-500">Click bar to triage</span>
          </div>
          <div ref={barContainerRef} className="w-full">
            <svg
              ref={barSvgRef}
              width={Math.max(barWidth, 260)}
              height={204}
              viewBox={`0 0 ${Math.max(barWidth, 260)} 204`}
              role="img"
              aria-label="Horizontal bar chart of flagged reports grouped by reason"
              className="block w-full overflow-visible"
            />
          </div>
        </div>
      </div>
    </section>
  );
};

export const AdminD3Charts: React.FC<AdminD3ChartsProps> = ({
  stats,
  isFullAdmin,
  onSelectSection,
}) => {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TotalUsersD3Chart
          stats={stats}
          isFullAdmin={isFullAdmin}
          onSelectSection={onSelectSection}
        />
        <ActivePostMetricsD3Chart
          stats={stats}
          isFullAdmin={isFullAdmin}
          onSelectSection={onSelectSection}
        />
      </div>
      <FlaggedReportsD3Chart
        stats={stats}
        onSelectSection={onSelectSection}
      />
    </div>
  );
};
