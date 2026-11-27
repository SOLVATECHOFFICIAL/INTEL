import type { EffectiveAccountTier } from './authValidation';
import {
  getVisibleAdminSections,
  type AdminDashboardSectionId,
  type AdminDashboardSectionMeta,
} from './adminPermissions';

export type AdminGroupId = 'overview' | 'people' | 'moderation' | 'campus';

export interface AdminNavGroup {
  id: AdminGroupId;
  label: string;
  shortDesc: string;
  sections: AdminDashboardSectionMeta[];
}

interface AdminGroupDefinition {
  id: AdminGroupId;
  label: string;
  shortDesc: string;
  sectionIds: readonly AdminDashboardSectionId[];
}

const ADMIN_GROUP_DEFINITIONS: readonly AdminGroupDefinition[] = [
  {
    id: 'overview',
    label: 'Overview',
    shortDesc: 'Live numbers, charts & quick actions',
    sectionIds: ['overview'],
  },
  {
    id: 'people',
    label: 'People & Trust',
    shortDesc: 'Members, badges & trusted campus contacts',
    sectionIds: ['members', 'badges', 'trusted-circle'],
  },
  {
    id: 'moderation',
    label: 'Moderation',
    shortDesc: 'Approve listings, posts & reported content',
    sectionIds: ['marketplace', 'content'],
  },
  {
    id: 'campus',
    label: 'Campus & System',
    shortDesc: 'Opportunities, events, activity log & settings',
    sectionIds: ['opportunities', 'events', 'audit-log', 'settings'],
  },
];

const SIMPLE_SECTION_LABELS: Record<AdminDashboardSectionId, { label: string; shortDesc: string }> = {
  overview: {
    label: 'Overview',
    shortDesc: 'At-a-glance activity, stats, and quick tasks.',
  },
  members: {
    label: 'Members',
    shortDesc: 'Find accounts, inspect status, suspend or restore.',
  },
  badges: {
    label: 'Badges',
    shortDesc: 'Assign Verified, Moderator, or Supreme Admin access.',
  },
  'trusted-circle': {
    label: 'Trusted Circle',
    shortDesc: 'Manage official campus reps and trusted contacts.',
  },
  marketplace: {
    label: 'Marketplace',
    shortDesc: 'Review pending items and manage listed items.',
  },
  content: {
    label: 'Posts & Reports',
    shortDesc: 'Review flagged content, posts, threads, and replies.',
  },
  opportunities: {
    label: 'Opportunities',
    shortDesc: 'Publish and manage scholarships, grants, and internships.',
  },
  events: {
    label: 'Events',
    shortDesc: 'Publish and manage campus events and venues.',
  },
  'audit-log': {
    label: 'Activity Log',
    shortDesc: 'Record of moderation, role, and settings actions.',
  },
  settings: {
    label: 'Settings',
    shortDesc: 'Site notice, pinned message, and admin permissions.',
  },
};

export function getSimpleAdminSectionMeta(section: AdminDashboardSectionMeta): AdminDashboardSectionMeta {
  const simple = SIMPLE_SECTION_LABELS[section.id];
  if (!simple) return section;
  return {
    ...section,
    label: simple.label,
    description: simple.shortDesc,
  };
}

export function buildAdminNavGroups(
  tier: EffectiveAccountTier,
  suspended: boolean
): AdminNavGroup[] {
  const visible = getVisibleAdminSections(tier, suspended);
  if (visible.length === 0) return [];

  const byId = new Map<AdminDashboardSectionId, AdminDashboardSectionMeta>();
  for (const item of visible) {
    byId.set(item.id, getSimpleAdminSectionMeta(item));
  }

  const groups: AdminNavGroup[] = [];
  for (const def of ADMIN_GROUP_DEFINITIONS) {
    const sections: AdminDashboardSectionMeta[] = [];
    for (const secId of def.sectionIds) {
      const found = byId.get(secId);
      if (found) sections.push(found);
    }
    if (sections.length > 0) {
      groups.push({
        id: def.id,
        label: def.label,
        shortDesc: def.shortDesc,
        sections,
      });
    }
  }
  return groups;
}

export function findGroupForAdminSection(
  groups: readonly AdminNavGroup[],
  sectionId: AdminDashboardSectionId
): AdminNavGroup | null {
  for (const group of groups) {
    if (group.sections.some((sec) => sec.id === sectionId)) {
      return group;
    }
  }
  return groups[0] ?? null;
}

export function resolveDefaultSectionForGroup(
  group: AdminNavGroup | null | undefined
): AdminDashboardSectionId {
  return group?.sections[0]?.id ?? 'overview';
}
