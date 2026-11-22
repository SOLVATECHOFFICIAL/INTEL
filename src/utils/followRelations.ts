import type {
  NotificationItem,
  PublicProfileProjection,
  TrustedContact,
  TrustedContactCategory,
} from '../types/database';

export type FollowRelationshipState =
  | 'self'
  | 'follow'
  | 'following'
  | 'follow_back'
  | 'friends';

export interface FollowButtonPresentation {
  label: string;
  ariaLabel: string;
  title: string;
}

export function normalizeFollowUsername(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function resolveFollowRelationshipState(input: {
  viewerUsername?: string | null;
  targetUsername: string;
  followingUsernames: ReadonlySet<string>;
  followerUsernames: ReadonlySet<string>;
}): FollowRelationshipState {
  const target = normalizeFollowUsername(input.targetUsername);
  const viewer = normalizeFollowUsername(input.viewerUsername);
  if (!target) {
    return 'follow';
  }
  if (viewer && viewer === target) {
    return 'self';
  }
  const isFollowing = input.followingUsernames.has(target);
  const isFollower = input.followerUsernames.has(target);

  if (isFollowing && isFollower) {
    return 'friends';
  }
  if (isFollowing) {
    return 'following';
  }
  if (isFollower) {
    return 'follow_back';
  }
  return 'follow';
}

export function resolveFollowButtonPresentation(
  state: Exclude<FollowRelationshipState, 'self'>,
  targetUsername: string
): FollowButtonPresentation {
  const handle = normalizeFollowUsername(targetUsername) || 'member';
  switch (state) {
    case 'friends':
      return {
        label: 'Friends',
        ariaLabel: `Friends with @${handle}. Click to unfollow.`,
        title: 'Friends (Mutual Follow) — Click to unfollow',
      };
    case 'following':
      return {
        label: 'Following',
        ariaLabel: `Following @${handle}. Click to unfollow.`,
        title: 'Following — Click to unfollow',
      };
    case 'follow_back':
      return {
        label: 'Follow Back',
        ariaLabel: `Follow back @${handle}`,
        title: 'Follows you — Click to follow back',
      };
    case 'follow':
    default:
      return {
        label: 'Follow',
        ariaLabel: `Follow @${handle}`,
        title: 'Follow',
      };
  }
}

export function applyOptimisticFollowUpdate(input: {
  viewerUsername?: string | null;
  targetUsername: string;
  nextFollowing: boolean;
  followingUsernames: ReadonlySet<string>;
  currentFollowingCount: number;
}): {
  followingUsernames: Set<string>;
  followingCount: number;
  changed: boolean;
} {
  const target = normalizeFollowUsername(input.targetUsername);
  const viewer = normalizeFollowUsername(input.viewerUsername);
  const nextSet = new Set(input.followingUsernames);

  if (!target || (viewer && viewer === target)) {
    return {
      followingUsernames: nextSet,
      followingCount: Math.max(0, input.currentFollowingCount),
      changed: false,
    };
  }

  const alreadyFollowing = nextSet.has(target);
  if (input.nextFollowing === alreadyFollowing) {
    return {
      followingUsernames: nextSet,
      followingCount: Math.max(0, input.currentFollowingCount),
      changed: false,
    };
  }

  if (input.nextFollowing) {
    nextSet.add(target);
  } else {
    nextSet.delete(target);
  }

  const nextCount = Math.max(
    0,
    input.currentFollowingCount + (input.nextFollowing ? 1 : -1)
  );

  return {
    followingUsernames: nextSet,
    followingCount: nextCount,
    changed: true,
  };
}

export function extractActorUsernameFromNotification(
  item: Pick<NotificationItem, 'actorUsername' | 'targetPath' | 'body'>
): string | null {
  if (item.actorUsername && /^[a-z0-9_]+$/i.test(item.actorUsername.trim())) {
    return item.actorUsername.trim().toLowerCase();
  }
  if (item.targetPath) {
    const pathMatch = item.targetPath.match(/[?&]username=([a-z0-9_]+)/i);
    if (pathMatch?.[1]) {
      return pathMatch[1].toLowerCase();
    }
  }
  if (item.body) {
    const mentionMatch = item.body.match(/@([a-z0-9_]+)/i);
    if (mentionMatch?.[1]) {
      return mentionMatch[1].toLowerCase();
    }
  }
  return null;
}

export type TrustedCircleCategoryFilter =
  | 'all'
  | 'supreme_admin'
  | 'officially_verified'
  | 'community_recommended'
  | 'official_contacts';

export const TRUSTED_CONTACT_CATEGORY_LABELS: Record<
  TrustedContactCategory,
  string
> = {
  officially_verified: 'Officially Verified',
  community_recommended: 'Community Recommended',
  lecturer: 'Lecturer',
  department_rep: 'Department Rep',
  faculty_president: 'Faculty President',
  class_rep: 'Class Rep',
  departmental_executive: 'Departmental Executive',
  student_union_rep: 'Student Union Rep',
};

export interface PartitionedTrustedCircleDirectory {
  supremeAdmins: PublicProfileProjection[];
  officiallyVerifiedUsers: PublicProfileProjection[];
  officiallyVerifiedContacts: TrustedContact[];
  communityRecommendedContacts: TrustedContact[];
  officialCampusContacts: TrustedContact[];
}

export function partitionTrustedCircleDirectory(input: {
  supremeAdmins: readonly PublicProfileProjection[];
  verifiedMembers: readonly PublicProfileProjection[];
  officialContacts: readonly TrustedContact[];
}): PartitionedTrustedCircleDirectory {
  const supremeAdmins = input.supremeAdmins.filter(
    (member) =>
      member.accountStatus === 'active' && member.badge === 'supreme_admin'
  );
  const officiallyVerifiedUsers = input.verifiedMembers.filter(
    (member) =>
      member.accountStatus === 'active' && member.badge === 'verified'
  );

  const safeContacts = input.officialContacts.filter(
    (contact) =>
      contact.entryType === 'admin_listed_contact' &&
      contact.isUserAccount === false
  );

  const officiallyVerifiedContacts: TrustedContact[] = [];
  const communityRecommendedContacts: TrustedContact[] = [];
  const officialCampusContacts: TrustedContact[] = [];

  for (const contact of safeContacts) {
    if (contact.category === 'officially_verified') {
      officiallyVerifiedContacts.push(contact);
    } else if (contact.category === 'community_recommended') {
      communityRecommendedContacts.push(contact);
    } else {
      officialCampusContacts.push(contact);
    }
  }

  return {
    supremeAdmins,
    officiallyVerifiedUsers,
    officiallyVerifiedContacts,
    communityRecommendedContacts,
    officialCampusContacts,
  };
}

export function canContactHaveFollowControl(
  entry: Pick<TrustedContact, 'isUserAccount' | 'entryType'>
): boolean {
  return entry.isUserAccount !== false && entry.entryType !== 'admin_listed_contact';
}
