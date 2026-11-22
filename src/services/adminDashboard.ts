import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
  type FieldValue,
  type WriteBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  BLUEPRINT_LIMITS,
  COLLECTION_NAMES,
  categorizeEventByDate,
  collectCommentTreeIds,
  isSafeMediaUrl,
  isValidFirestoreId,
  resolveOpportunityEffectiveStatus,
  validateTrustedContactPayload,
  type AdminAuditAction,
  type AdminAuditLog,
  type AnonymousAuditLog,
  type AnonymousComment,
  type AnonymousPost,
  type AnonymousReport,
  type BadgeAuditLog,
  type CampusEvent,
  type CampusEventStatus,
  type CommunityPost,
  type MarketplaceListing,
  type MarketplaceStatus,
  type Opportunity,
  type PlatformSetting,
  type PostComment,
  type PublicProfileProjection,
  type PublicUserProfile,
  type TrustedContact,
  type TrustedContactCategory,
  type UserRole,
  type UserRoleRecord,
} from '../types/database';
import {
  computePlatformOverviewStats,
  validateCampusEventFormInput,
  validateOpportunityFormInput,
  type CampusEventFormInput,
  type OpportunityFormInput,
  type PlatformOverviewStats,
} from '../utils/adminPermissions';
import { toPublicProfileProjection } from '../utils/authValidation';
import { extractTimestampMs } from '../utils/contextualSearch';
import {
  fetchAnonymousAuditLogs,
  fetchBadgeAuditLogs,
  reviewPendingMarketplaceListing,
} from './governance';
import { evictMediaImageCache, generateFirestoreDocId } from './mediaStorage';
import { deletePostComment, deletePostCascading } from './socialPosts';

function sortByCreatedAtDesc<T extends { createdAt: unknown }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aMs = extractTimestampMs(a.createdAt) ?? 0;
    const bMs = extractTimestampMs(b.createdAt) ?? 0;
    return bMs - aMs;
  });
}

function getAuditActorRole(
  role: UserRole
): 'owner' | 'supreme_admin' | 'moderator' {
  if (role === 'owner') return 'owner';
  if (role === 'supreme_admin') return 'supreme_admin';
  return 'moderator';
}

export function attachAdminAuditLogToBatch(
  batch: WriteBatch,
  input: {
    action: AdminAuditAction;
    targetCollection: string;
    targetId: string;
    targetLabel?: string;
    performedByUid: string;
    performedByRole: UserRole;
    details?: string;
  }
): string {
  const logId = generateFirestoreDocId(COLLECTION_NAMES.adminAuditLogs);
  const cleanLabel = input.targetLabel?.trim().slice(0, 180);
  const cleanDetails = input.details
    ?.trim()
    .slice(0, BLUEPRINT_LIMITS.auditReasonMax);

  const payload: Record<string, unknown> = {
    id: logId,
    action: input.action,
    targetCollection: input.targetCollection.slice(0, 64),
    targetId: input.targetId,
    performedByUid: input.performedByUid,
    performedByRole: getAuditActorRole(input.performedByRole),
    createdAt: serverTimestamp(),
  };

  if (cleanLabel) {
    payload.targetLabel = cleanLabel;
  }
  if (cleanDetails) {
    payload.details = cleanDetails;
  }

  batch.set(doc(db, COLLECTION_NAMES.adminAuditLogs, logId), payload);
  return logId;
}

export async function recordAdminAuditLog(input: {
  action: AdminAuditAction;
  targetCollection: string;
  targetId: string;
  targetLabel?: string;
  performedByUid: string;
  performedByRole: UserRole;
  details?: string;
}): Promise<string> {
  const batch = writeBatch(db);
  const logId = attachAdminAuditLogToBatch(batch, input);
  await batch.commit();
  return logId;
}

export type UnifiedAuditEntry =
  | {
      kind: 'badge';
      id: string;
      createdAt: unknown;
      data: BadgeAuditLog;
    }
  | {
      kind: 'admin';
      id: string;
      createdAt: unknown;
      data: AdminAuditLog;
    }
  | {
      kind: 'anonymous_reveal';
      id: string;
      createdAt: unknown;
      data: AnonymousAuditLog;
    };

export interface AdminOverviewBundle {
  stats: PlatformOverviewStats;
  recentAudits: UnifiedAuditEntry[];
  pendingListings: MarketplaceListing[];
}

export async function fetchPlatformOverviewData(input: {
  actorRole: UserRole;
}): Promise<AdminOverviewBundle> {
  const isFullAdmin =
    input.actorRole === 'owner' || input.actorRole === 'supreme_admin';

  try {
    const usersQuery = isFullAdmin
      ? query(collection(db, COLLECTION_NAMES.users), limit(500))
      : query(
          collection(db, COLLECTION_NAMES.users),
          where('isHiddenFromDirectory', '==', false),
          limit(500)
        );

    const [
      usersSnap,
      postsSnap,
      anonPostsSnap,
      listingsSnap,
      oppsSnap,
      eventsSnap,
      badgeLogs,
      adminLogs,
      anonLogs,
    ] = await Promise.all([
      getDocs(usersQuery),
      getDocs(
        query(
          collection(db, COLLECTION_NAMES.posts),
          where('status', '==', 'published'),
          limit(500)
        )
      ),
      getDocs(
        query(
          collection(db, COLLECTION_NAMES.anonymousPosts),
          where('status', '==', 'published'),
          limit(500)
        )
      ),
      getDocs(query(collection(db, COLLECTION_NAMES.marketplaceListings), limit(500))),
      getDocs(query(collection(db, COLLECTION_NAMES.opportunities), limit(250))),
      getDocs(query(collection(db, COLLECTION_NAMES.events), limit(250))),
      isFullAdmin ? fetchBadgeAuditLogs(15).catch(() => []) : Promise.resolve([]),
      isFullAdmin ? fetchAdminAuditLogs(15).catch(() => []) : Promise.resolve([]),
      isFullAdmin ? fetchAnonymousAuditLogs(10).catch(() => []) : Promise.resolve([]),
    ]);

    // Always exclude hidden project-owner accounts from public-facing member metrics
    const visibleProfiles = usersSnap.docs
      .map((item) => item.data() as PublicUserProfile)
      .filter((profile) => !profile.isHiddenFromDirectory);

    const listings = listingsSnap.docs.map(
      (item) => item.data() as MarketplaceListing
    );
    const opportunities = oppsSnap.docs.map((item) => item.data() as Opportunity);
    const events = eventsSnap.docs.map((item) => item.data() as CampusEvent);

    const stats = computePlatformOverviewStats({
      profiles: visibleProfiles,
      ordinaryPostsCount: postsSnap.size,
      anonymousPostsCount: anonPostsSnap.size,
      listings,
      opportunities,
      events,
    });

    const unifiedAudits: UnifiedAuditEntry[] = [
      ...badgeLogs.map((data) => ({
        kind: 'badge' as const,
        id: `badge_${data.id}`,
        createdAt: data.createdAt,
        data,
      })),
      ...adminLogs.map((data) => ({
        kind: 'admin' as const,
        id: `admin_${data.id}`,
        createdAt: data.createdAt,
        data,
      })),
      ...anonLogs.map((data) => ({
        kind: 'anonymous_reveal' as const,
        id: `anon_${data.id}`,
        createdAt: data.createdAt,
        data,
      })),
    ]
      .sort((a, b) => {
        const aMs = extractTimestampMs(a.createdAt) ?? 0;
        const bMs = extractTimestampMs(b.createdAt) ?? 0;
        return bMs - aMs;
      })
      .slice(0, 12);

    const pendingListings = sortByCreatedAtDesc(
      listings.filter((item) => item.approvalStatus === 'pending_approval')
    ).slice(0, 10);

    return {
      stats,
      recentAudits: unifiedAudits,
      pendingListings,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAMES.users);
  }
}

export interface AdminMemberDetailsBundle {
  profile: PublicUserProfile;
  roleRecord: UserRoleRecord | null;
  publishedPostsCount: number;
  listingsCount: number;
  recentBadgeAudits: BadgeAuditLog[];
}

export async function fetchMemberDetailsForAdmin(
  uid: string
): Promise<AdminMemberDetailsBundle> {
  if (!isValidFirestoreId(uid)) {
    throw new Error('Invalid member UID.');
  }

  try {
    const [userSnap, roleSnap, postsSnap, listingsSnap, auditsSnap] =
      await Promise.all([
        getDoc(doc(db, COLLECTION_NAMES.users, uid)),
        getDoc(doc(db, COLLECTION_NAMES.userRoles, uid)),
        getDocs(
          query(
            collection(db, COLLECTION_NAMES.posts),
            where('ownerUID', '==', uid),
            limit(200)
          )
        ).catch(() => null),
        getDocs(
          query(
            collection(db, COLLECTION_NAMES.marketplaceListings),
            where('ownerUID', '==', uid),
            limit(200)
          )
        ).catch(() => null),
        getDocs(
          query(
            collection(db, COLLECTION_NAMES.badgeAuditLogs),
            where('targetUid', '==', uid),
            limit(15)
          )
        ).catch(() => null),
      ]);

    if (!userSnap.exists()) {
      throw new Error('Member profile record not found.');
    }

    const recentBadgeAudits = auditsSnap
      ? sortByCreatedAtDesc(
          auditsSnap.docs.map((item) => item.data() as BadgeAuditLog)
        )
      : [];

    const publishedPostsCount = postsSnap
      ? postsSnap.docs.filter(
          (item) => (item.data() as CommunityPost).status === 'published'
        ).length
      : 0;

    return {
      profile: userSnap.data() as PublicUserProfile,
      roleRecord: roleSnap.exists() ? (roleSnap.data() as UserRoleRecord) : null,
      publishedPostsCount,
      listingsCount: listingsSnap ? listingsSnap.size : 0,
      recentBadgeAudits,
    };
  } catch (error) {
    if (error instanceof Error && !('code' in error)) {
      throw error;
    }
    handleFirestoreError(
      error,
      OperationType.GET,
      `${COLLECTION_NAMES.users}/${uid}`
    );
  }
}

export interface AdminMarketplaceItem {
  listing: MarketplaceListing;
  seller: PublicProfileProjection | null;
}

async function fetchPublicProfileMapByUids(
  uids: string[]
): Promise<Map<string, PublicProfileProjection>> {
  const uniqueUids = Array.from(new Set(uids.filter(isValidFirestoreId)));
  const map = new Map<string, PublicProfileProjection>();
  if (uniqueUids.length === 0) return map;

  const settled = await Promise.allSettled(
    uniqueUids.map(async (uid) => {
      const snap = await getDoc(doc(db, COLLECTION_NAMES.users, uid));
      if (!snap.exists()) return null;
      return {
        uid,
        projection: toPublicProfileProjection(snap.data() as PublicUserProfile),
      };
    })
  );

  for (const res of settled) {
    if (res.status === 'fulfilled' && res.value) {
      map.set(res.value.uid, res.value.projection);
    }
  }
  return map;
}

export async function fetchAdminMarketplaceDirectory(): Promise<
  AdminMarketplaceItem[]
> {
  try {
    const snap = await getDocs(
      query(collection(db, COLLECTION_NAMES.marketplaceListings), limit(150))
    );
    const listings = sortByCreatedAtDesc(
      snap.docs.map((item) => item.data() as MarketplaceListing)
    );
    const sellersMap = await fetchPublicProfileMapByUids(
      listings.map((item) => item.ownerUID)
    );

    return listings.map((listing) => ({
      listing,
      seller: sellersMap.get(listing.ownerUID) ?? null,
    }));
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.LIST,
      COLLECTION_NAMES.marketplaceListings
    );
  }
}

export async function reviewMarketplaceListingWithAudit(input: {
  listing: MarketplaceListing;
  actorUid: string;
  actorRole: UserRole;
  decision: 'approved' | 'rejected';
  note?: string;
}): Promise<MarketplaceListing> {
  const updated = await reviewPendingMarketplaceListing({
    listingId: input.listing.id,
    actorUid: input.actorUid,
    actorRole: input.actorRole,
    decision: input.decision,
  });

  const batch = writeBatch(db);
  attachAdminAuditLogToBatch(batch, {
    action:
      input.decision === 'approved'
        ? 'marketplace_approved'
        : 'marketplace_rejected',
    targetCollection: COLLECTION_NAMES.marketplaceListings,
    targetId: input.listing.id,
    targetLabel: input.listing.title,
    performedByUid: input.actorUid,
    performedByRole: input.actorRole,
    details:
      input.note?.trim() ||
      (input.decision === 'approved'
        ? 'Approved for 7-day Campus Marketplace visibility.'
        : 'Rejected during marketplace moderation review.'),
  });

  const notifId = generateFirestoreDocId(COLLECTION_NAMES.notifications);
  batch.set(doc(db, COLLECTION_NAMES.notifications, notifId), {
    id: notifId,
    recipientUid: input.listing.ownerUID,
    eventType:
      input.decision === 'approved'
        ? 'marketplace_approved'
        : 'marketplace_rejected',
    title:
      input.decision === 'approved'
        ? `Marketplace listing approved: ${input.listing.title}`
        : `Marketplace listing declined: ${input.listing.title}`,
    body:
      input.note?.trim() ||
      (input.decision === 'approved'
        ? 'Your listing is now visible in Campus Marketplace for 7 days.'
        : 'Your submission did not pass marketplace moderation guidelines.'),
    targetPath: '/?view=marketplace',
    isRead: false,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch {
    // Primary transaction already persisted cleanly; avoid losing UI refresh if notification fails.
  }

  return updated;
}

export async function adminUpdateMarketplaceStatusWithAudit(input: {
  listing: MarketplaceListing;
  nextStatus: MarketplaceStatus;
  actorUid: string;
  actorRole: UserRole;
}): Promise<MarketplaceListing> {
  if (input.actorRole !== 'owner' && input.actorRole !== 'supreme_admin') {
    throw new Error('Only Supreme Admin or Owner can override marketplace status.');
  }

  const nextVisibility =
    input.nextStatus === 'active' ? 'public' : 'owner_and_admins';
  const batch = writeBatch(db);
  batch.update(doc(db, COLLECTION_NAMES.marketplaceListings, input.listing.id), {
    status: input.nextStatus,
    visibility: nextVisibility,
    updatedAt: serverTimestamp(),
  });
  attachAdminAuditLogToBatch(batch, {
    action: 'marketplace_status_updated',
    targetCollection: COLLECTION_NAMES.marketplaceListings,
    targetId: input.listing.id,
    targetLabel: input.listing.title,
    performedByUid: input.actorUid,
    performedByRole: input.actorRole,
    details: `Status updated from ${input.listing.status} to ${input.nextStatus}.`,
  });

  try {
    await batch.commit();
    return {
      ...input.listing,
      status: input.nextStatus,
      visibility: nextVisibility,
      updatedAt: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `${COLLECTION_NAMES.marketplaceListings}/${input.listing.id}`
    );
  }
}

export async function adminDeleteMarketplaceListingWithAudit(input: {
  listing: MarketplaceListing;
  actorUid: string;
  actorRole: UserRole;
  reason?: string;
}): Promise<void> {
  if (input.actorRole !== 'owner' && input.actorRole !== 'supreme_admin') {
    throw new Error('Only Supreme Admin or Owner can permanently remove listings.');
  }

  const mediaSnap = await getDocs(
    query(
      collection(db, COLLECTION_NAMES.mediaImages),
      where('targetCollection', '==', 'marketplaceListings'),
      where('targetId', '==', input.listing.id),
      limit(10)
    )
  ).catch(() => null);

  const batch = writeBatch(db);
  if (mediaSnap) {
    for (const imgDoc of mediaSnap.docs) {
      batch.delete(imgDoc.ref);
    }
  }
  batch.delete(doc(db, COLLECTION_NAMES.marketplaceListings, input.listing.id));
  attachAdminAuditLogToBatch(batch, {
    action: 'marketplace_removed',
    targetCollection: COLLECTION_NAMES.marketplaceListings,
    targetId: input.listing.id,
    targetLabel: input.listing.title,
    performedByUid: input.actorUid,
    performedByRole: input.actorRole,
    details: input.reason?.trim() || 'Removed by administrator.',
  });

  try {
    await batch.commit();
    if (mediaSnap) {
      for (const imgDoc of mediaSnap.docs) {
        evictMediaImageCache(imgDoc.id);
      }
    }
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.DELETE,
      `${COLLECTION_NAMES.marketplaceListings}/${input.listing.id}`
    );
  }
}

export interface AdminCommunityPostItem {
  post: CommunityPost;
  author: PublicProfileProjection | null;
}

export interface AdminPostCommentItem {
  kind: 'posts' | 'anonymousPosts';
  comment: PostComment | AnonymousComment;
  author: PublicProfileProjection | null;
}

export async function fetchAdminCommunityContentBundle(): Promise<{
  ordinaryPosts: AdminCommunityPostItem[];
  anonymousPosts: AnonymousPost[];
  ordinaryComments: AdminPostCommentItem[];
  anonymousComments: AdminPostCommentItem[];
  anonymousReports: AnonymousReport[];
}> {
  try {
    const [
      postsSnap,
      anonPostsSnap,
      postCommentsSnap,
      anonCommentsSnap,
      anonReportsSnap,
    ] = await Promise.all([
      getDocs(
        query(
          collection(db, COLLECTION_NAMES.posts),
          where('status', '==', 'published'),
          limit(80)
        )
      ),
      getDocs(
        query(
          collection(db, COLLECTION_NAMES.anonymousPosts),
          where('status', '==', 'published'),
          limit(80)
        )
      ),
      getDocs(
        query(
          collection(db, COLLECTION_NAMES.postComments),
          where('status', '==', 'published'),
          limit(100)
        )
      ),
      getDocs(
        query(
          collection(db, COLLECTION_NAMES.anonymousComments),
          where('status', '==', 'published'),
          limit(100)
        )
      ),
      getDocs(
        query(collection(db, COLLECTION_NAMES.anonymousReports), limit(100))
      ).catch(() => null),
    ]);

    const rawPosts = sortByCreatedAtDesc(
      postsSnap.docs.map((item) => item.data() as CommunityPost)
    );
    const rawComments = sortByCreatedAtDesc(
      postCommentsSnap.docs.map((item) => item.data() as PostComment)
    );

    const profileMap = await fetchPublicProfileMapByUids([
      ...rawPosts.map((p) => p.ownerUID),
      ...rawComments.map((c) => c.ownerUID),
    ]);

    return {
      ordinaryPosts: rawPosts.map((post) => ({
        post,
        author: profileMap.get(post.ownerUID) ?? null,
      })),
      anonymousPosts: sortByCreatedAtDesc(
        anonPostsSnap.docs.map((item) => item.data() as AnonymousPost)
      ),
      ordinaryComments: rawComments.map((comment) => ({
        kind: 'posts' as const,
        comment,
        author: profileMap.get(comment.ownerUID) ?? null,
      })),
      // Strictly NO author lookup on anonymous comments!
      anonymousComments: sortByCreatedAtDesc(
        anonCommentsSnap.docs.map((item) => item.data() as AnonymousComment)
      ).map((comment) => ({
        kind: 'anonymousPosts' as const,
        comment,
        author: null,
      })),
      anonymousReports: anonReportsSnap
        ? sortByCreatedAtDesc(
            anonReportsSnap.docs.map((item) => item.data() as AnonymousReport)
          )
        : [],
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAMES.posts);
  }
}

export async function resolveAnonymousReportWithAudit(input: {
  report: AnonymousReport;
  decision: 'reviewed_removed' | 'dismissed';
  actorUid: string;
  actorRole: UserRole;
  resolutionNote?: string;
  targetPost?: AnonymousPost | null;
  targetComment?: AnonymousComment | null;
  allAnonymousComments?: readonly AnonymousComment[];
}): Promise<AnonymousReport> {
  const isModeratorOrAdmin =
    input.actorRole === 'owner' ||
    input.actorRole === 'supreme_admin' ||
    input.actorRole === 'moderator';
  if (!isModeratorOrAdmin) {
    throw new Error('Only Moderators and Administrators can resolve reports.');
  }

  const cleanNote = input.resolutionNote?.trim().slice(0, 500) ?? '';

  if (input.decision === 'reviewed_removed') {
    if (input.report.targetType === 'anonymousPost') {
      let postToDelete = input.targetPost ?? null;
      if (!postToDelete) {
        const postSnap = await getDoc(
          doc(db, COLLECTION_NAMES.anonymousPosts, input.report.targetId)
        ).catch(() => null);
        if (postSnap?.exists()) {
          postToDelete = postSnap.data() as AnonymousPost;
        }
      }
      if (postToDelete) {
        try {
          await deletePostCascading({
            kind: 'anonymousPosts',
            post: postToDelete,
            actorUid: input.actorUid,
          });
        } catch (error) {
          const isFullAdmin =
            input.actorRole === 'owner' || input.actorRole === 'supreme_admin';
          const msg = error instanceof Error ? error.message : '';
          if (!isFullAdmin && /permission|insufficient/i.test(msg)) {
            throw new Error(
              'Moderators cannot delete anonymous posts belonging to Verified, Moderator, or Admin accounts.',
              { cause: error }
            );
          }
          throw error;
        }
      }
    } else {
      let commentToDelete = input.targetComment ?? null;
      if (!commentToDelete) {
        const commentSnap = await getDoc(
          doc(db, COLLECTION_NAMES.anonymousComments, input.report.targetId)
        ).catch(() => null);
        if (commentSnap?.exists()) {
          commentToDelete = commentSnap.data() as AnonymousComment;
        }
      }
      if (commentToDelete) {
        await adminDeleteCommentWithAudit({
          kind: 'anonymousPosts',
          comment: commentToDelete,
          allCommentsInSameKind: input.allAnonymousComments ?? [commentToDelete],
          actorUid: input.actorUid,
          actorRole: input.actorRole,
          reason: cleanNote || `Removed via anonymous report (${input.report.reason}).`,
        });
      }
    }
  }

  const actorAuditRole = getAuditActorRole(input.actorRole);
  const batch = writeBatch(db);

  batch.update(
    doc(db, COLLECTION_NAMES.anonymousReports, input.report.id),
    {
      status: input.decision,
      reviewedByUid: input.actorUid,
      reviewedByRole: actorAuditRole,
      updatedAt: serverTimestamp(),
      ...(cleanNote ? { resolutionNote: cleanNote } : {}),
    }
  );
  attachAdminAuditLogToBatch(batch, {
    action:
      input.decision === 'reviewed_removed'
        ? 'anonymous_report_removed'
        : 'anonymous_report_dismissed',
    targetCollection: COLLECTION_NAMES.anonymousReports,
    targetId: input.report.id,
    targetLabel: `${input.report.targetType}: ${input.report.excerpt.slice(0, 80)}`,
    performedByUid: input.actorUid,
    performedByRole: input.actorRole,
    details:
      cleanNote ||
      (input.decision === 'reviewed_removed'
        ? `Removed reported content (${input.report.reason}).`
        : `Dismissed report (${input.report.reason}).`),
  });

  const path = `${COLLECTION_NAMES.anonymousReports}/${input.report.id}`;
  try {
    await batch.commit();
    return {
      ...input.report,
      status: input.decision,
      reviewedByUid: input.actorUid,
      reviewedByRole: actorAuditRole,
      resolutionNote: cleanNote || undefined,
      updatedAt: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adminDeleteCommunityPostWithAudit(input: {
  kind: 'posts' | 'anonymousPosts';
  post: CommunityPost | AnonymousPost;
  actorUid: string;
  actorRole: UserRole;
  reason?: string;
}): Promise<void> {
  await deletePostCascading({
    kind: input.kind,
    post: input.post,
    actorUid: input.actorUid,
  });

  const label =
    input.kind === 'posts'
      ? (input.post as CommunityPost).title ||
        input.post.body.slice(0, 100) ||
        input.post.id
      : input.post.body.slice(0, 100) || input.post.id;

  await recordAdminAuditLog({
    action: input.kind === 'posts' ? 'post_deleted' : 'anonymous_post_deleted',
    targetCollection: input.kind,
    targetId: input.post.id,
    targetLabel: label,
    performedByUid: input.actorUid,
    performedByRole: input.actorRole,
    details: input.reason?.trim() || `Removed ${input.kind} entry from moderation console.`,
  }).catch(() => undefined);
}

export async function adminDeleteCommentWithAudit(input: {
  kind: 'posts' | 'anonymousPosts';
  comment: PostComment | AnonymousComment;
  allCommentsInSameKind: readonly (PostComment | AnonymousComment)[];
  authorBadgesByUid?: ReadonlyMap<string, string>;
  actorUid: string;
  actorRole: UserRole;
  reason?: string;
}): Promise<void> {
  const isFullAdmin =
    input.actorRole === 'owner' || input.actorRole === 'supreme_admin';

  if (input.kind === 'posts' && !isFullAdmin) {
    const postComment = input.comment as PostComment;
    let targetBadge = input.authorBadgesByUid?.get(postComment.ownerUID);
    if (!targetBadge && isValidFirestoreId(postComment.ownerUID)) {
      const snap = await getDoc(
        doc(db, COLLECTION_NAMES.users, postComment.ownerUID)
      ).catch(() => null);
      targetBadge = snap?.exists()
        ? (snap.data() as PublicUserProfile).badge
        : 'none';
    }
    if (targetBadge && targetBadge !== 'none') {
      throw new Error(
        'Moderators can only delete comments made by ordinary members.'
      );
    }
  }

  const postComments = input.allCommentsInSameKind.filter(
    (c) => c.postId === input.comment.postId
  );
  const treeIds = collectCommentTreeIds(postComments, input.comment.id);
  let replyIds = treeIds.filter((id) => id !== input.comment.id);

  if (input.kind === 'posts' && !isFullAdmin && replyIds.length > 0) {
    const commentById = new Map(
      (postComments as PostComment[]).map((item) => [item.id, item])
    );
    const missingUids = replyIds
      .map((id) => commentById.get(id)?.ownerUID)
      .filter(
        (uid): uid is string =>
          Boolean(uid) &&
          isValidFirestoreId(uid!) &&
          !input.authorBadgesByUid?.has(uid!)
      );
    const fetchedMap =
      missingUids.length > 0
        ? await fetchPublicProfileMapByUids(missingUids)
        : new Map<string, PublicProfileProjection>();

    replyIds = replyIds.filter((id) => {
      const ownerUid = commentById.get(id)?.ownerUID;
      if (!ownerUid) return false;
      const badge =
        input.authorBadgesByUid?.get(ownerUid) ??
        fetchedMap.get(ownerUid)?.badge ??
        'none';
      return badge === 'none';
    });
  }

  try {
    await deletePostComment({
      kind: input.kind,
      postId: input.comment.postId,
      commentId: input.comment.id,
      replyIdsToRemove: replyIds,
      actorUid: input.actorUid,
    });
  } catch (error) {
    if (!isFullAdmin && input.kind === 'anonymousPosts') {
      const msg = error instanceof Error ? error.message : '';
      if (/permission|insufficient/i.test(msg)) {
        throw new Error(
          'Moderators cannot delete anonymous comments or replies belonging to Verified, Moderator, or Admin accounts.',
          { cause: error }
        );
      }
    }
    throw error;
  }

  await recordAdminAuditLog({
    action:
      input.kind === 'posts'
        ? 'post_comment_deleted'
        : 'anonymous_comment_deleted',
    targetCollection:
      input.kind === 'posts'
        ? COLLECTION_NAMES.postComments
        : COLLECTION_NAMES.anonymousComments,
    targetId: input.comment.id,
    targetLabel: input.comment.body.slice(0, 100),
    performedByUid: input.actorUid,
    performedByRole: input.actorRole,
    details: input.reason?.trim() || 'Removed comment via content moderation.',
  }).catch(() => undefined);
}

export async function adminTogglePostFlagsWithAudit(input: {
  post: CommunityPost;
  isPinned?: boolean;
  isOfficial?: boolean;
  actorUid: string;
  actorRole: UserRole;
}): Promise<CommunityPost> {
  if (input.actorRole !== 'owner' && input.actorRole !== 'supreme_admin') {
    throw new Error('Only Supreme Admin or Owner can pin or mark posts official.');
  }

  const nextPinned =
    typeof input.isPinned === 'boolean' ? input.isPinned : input.post.isPinned;
  const nextOfficial =
    typeof input.isOfficial === 'boolean'
      ? input.isOfficial
      : input.post.isOfficial;

  const batch = writeBatch(db);
  batch.update(doc(db, COLLECTION_NAMES.posts, input.post.id), {
    isPinned: nextPinned,
    isOfficial: nextOfficial,
    updatedAt: serverTimestamp(),
  });

  const action: AdminAuditAction =
    typeof input.isPinned === 'boolean'
      ? nextPinned
        ? 'post_pinned'
        : 'post_unpinned'
      : 'post_official_toggled';

  attachAdminAuditLogToBatch(batch, {
    action,
    targetCollection: COLLECTION_NAMES.posts,
    targetId: input.post.id,
    targetLabel: input.post.title || input.post.body.slice(0, 100),
    performedByUid: input.actorUid,
    performedByRole: input.actorRole,
    details: `isPinned=${String(nextPinned)}, isOfficial=${String(nextOfficial)}`,
  });

  try {
    await batch.commit();
    return {
      ...input.post,
      isPinned: nextPinned,
      isOfficial: nextOfficial,
      updatedAt: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `${COLLECTION_NAMES.posts}/${input.post.id}`
    );
  }
}

export async function fetchAllOpportunities(): Promise<Opportunity[]> {
  try {
    const snap = await getDocs(
      query(collection(db, COLLECTION_NAMES.opportunities), limit(120))
    );
    return sortByCreatedAtDesc(
      snap.docs.map((item) => item.data() as Opportunity)
    );
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.LIST,
      COLLECTION_NAMES.opportunities
    );
  }
}

export async function createOpportunityRecord(input: {
  form: OpportunityFormInput;
  actorUid: string;
  actorRole: UserRole;
}): Promise<Opportunity> {
  if (input.actorRole !== 'owner' && input.actorRole !== 'supreme_admin') {
    throw new Error('Only Supreme Admin or Owner can publish opportunities.');
  }
  const validationError = validateOpportunityFormInput(input.form);
  if (validationError) {
    throw new Error(validationError);
  }

  const oppId = generateFirestoreDocId(COLLECTION_NAMES.opportunities);
  const deadlineMs = Date.parse(input.form.expiresAtIso);
  const status =
    input.form.status === 'expired' || deadlineMs <= Date.now()
      ? 'expired'
      : 'active';

  const payload: Record<string, unknown> = {
    id: oppId,
    ownerUID: input.actorUid,
    category: input.form.category,
    title: input.form.title.trim(),
    organisation: input.form.organisation.trim(),
    description: input.form.description.trim(),
    applicationUrl: input.form.applicationUrl.trim(),
    status,
    expiresAt: Timestamp.fromMillis(deadlineMs),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (input.form.eligibility?.trim()) {
    payload.eligibility = input.form.eligibility.trim().slice(0, 1500);
  }
  if (input.form.requiredDocuments?.trim()) {
    payload.requiredDocuments = input.form.requiredDocuments.trim().slice(0, 1500);
  }
  if (input.form.benefits?.trim()) {
    payload.benefits = input.form.benefits.trim().slice(0, 1500);
  }
  if (input.form.applicationInstructions?.trim()) {
    payload.applicationInstructions = input.form.applicationInstructions
      .trim()
      .slice(0, 2000);
  }
  if (input.form.contactInfo?.trim()) {
    payload.contactInfo = input.form.contactInfo.trim().slice(0, 256);
  }

  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTION_NAMES.opportunities, oppId), payload);
  attachAdminAuditLogToBatch(batch, {
    action: 'opportunity_created',
    targetCollection: COLLECTION_NAMES.opportunities,
    targetId: oppId,
    targetLabel: input.form.title.trim(),
    performedByUid: input.actorUid,
    performedByRole: input.actorRole,
    details: `${input.form.category} · ${input.form.organisation.trim()}`,
  });

  try {
    await batch.commit();
    return {
      ...(payload as unknown as Opportunity),
      expiresAt: deadlineMs,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `${COLLECTION_NAMES.opportunities}/${oppId}`
    );
  }
}

export async function updateOpportunityRecord(input: {
  existing: Opportunity;
  form: OpportunityFormInput;
  actorUid: string;
  actorRole: UserRole;
}): Promise<Opportunity> {
  if (input.actorRole !== 'owner' && input.actorRole !== 'supreme_admin') {
    throw new Error('Only Supreme Admin or Owner can edit opportunities.');
  }
  const validationError = validateOpportunityFormInput(input.form);
  if (validationError) {
    throw new Error(validationError);
  }

  const deadlineMs = Date.parse(input.form.expiresAtIso);
  const nextStatus = input.form.status ?? resolveOpportunityEffectiveStatus(input.existing, deadlineMs);

  const updates: Record<
    string,
    FieldValue | string | number | boolean | Timestamp | undefined
  > = {
    category: input.form.category,
    title: input.form.title.trim(),
    organisation: input.form.organisation.trim(),
    description: input.form.description.trim(),
    applicationUrl: input.form.applicationUrl.trim(),
    eligibility: input.form.eligibility?.trim()
      ? input.form.eligibility.trim().slice(0, 1500)
      : deleteField(),
    requiredDocuments: input.form.requiredDocuments?.trim()
      ? input.form.requiredDocuments.trim().slice(0, 1500)
      : deleteField(),
    benefits: input.form.benefits?.trim()
      ? input.form.benefits.trim().slice(0, 1500)
      : deleteField(),
    applicationInstructions: input.form.applicationInstructions?.trim()
      ? input.form.applicationInstructions.trim().slice(0, 2000)
      : deleteField(),
    contactInfo: input.form.contactInfo?.trim()
      ? input.form.contactInfo.trim().slice(0, 256)
      : deleteField(),
    status: nextStatus,
    expiresAt: Timestamp.fromMillis(deadlineMs),
    updatedAt: serverTimestamp(),
  };

  const batch = writeBatch(db);
  batch.update(doc(db, COLLECTION_NAMES.opportunities, input.existing.id), updates);
  attachAdminAuditLogToBatch(batch, {
    action: nextStatus === 'expired' && input.existing.status !== 'expired'
      ? 'opportunity_expired'
      : 'opportunity_updated',
    targetCollection: COLLECTION_NAMES.opportunities,
    targetId: input.existing.id,
    targetLabel: input.form.title.trim(),
    performedByUid: input.actorUid,
    performedByRole: input.actorRole,
    details: `Status: ${nextStatus}`,
  });

  try {
    await batch.commit();
    return {
      ...input.existing,
      category: input.form.category,
      title: input.form.title.trim(),
      organisation: input.form.organisation.trim(),
      description: input.form.description.trim(),
      applicationUrl: input.form.applicationUrl.trim(),
      eligibility: input.form.eligibility?.trim() || undefined,
      requiredDocuments: input.form.requiredDocuments?.trim() || undefined,
      benefits: input.form.benefits?.trim() || undefined,
      applicationInstructions:
        input.form.applicationInstructions?.trim() || undefined,
      contactInfo: input.form.contactInfo?.trim() || undefined,
      status: nextStatus,
      expiresAt: deadlineMs,
      updatedAt: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `${COLLECTION_NAMES.opportunities}/${input.existing.id}`
    );
  }
}

export async function deleteOpportunityRecord(input: {
  opportunity: Opportunity;
  actorUid: string;
  actorRole: UserRole;
}): Promise<void> {
  if (input.actorRole !== 'owner' && input.actorRole !== 'supreme_admin') {
    throw new Error('Only Supreme Admin or Owner can remove opportunities.');
  }
  const batch = writeBatch(db);
  batch.delete(doc(db, COLLECTION_NAMES.opportunities, input.opportunity.id));
  attachAdminAuditLogToBatch(batch, {
    action: 'opportunity_deleted',
    targetCollection: COLLECTION_NAMES.opportunities,
    targetId: input.opportunity.id,
    targetLabel: input.opportunity.title,
    performedByUid: input.actorUid,
    performedByRole: input.actorRole,
    details: `Removed opportunity by ${input.opportunity.organisation}`,
  });
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.DELETE,
      `${COLLECTION_NAMES.opportunities}/${input.opportunity.id}`
    );
  }
}

export async function fetchAllCampusEvents(): Promise<CampusEvent[]> {
  try {
    const snap = await getDocs(
      query(collection(db, COLLECTION_NAMES.events), limit(120))
    );
    return snap.docs
      .map((item) => item.data() as CampusEvent)
      .sort((a, b) => {
        const aMs = extractTimestampMs(a.eventDate) ?? 0;
        const bMs = extractTimestampMs(b.eventDate) ?? 0;
        return aMs - bMs;
      });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAMES.events);
  }
}

export async function createCampusEventRecord(input: {
  form: CampusEventFormInput;
  actorUid: string;
  actorRole: UserRole;
}): Promise<CampusEvent> {
  if (input.actorRole !== 'owner' && input.actorRole !== 'supreme_admin') {
    throw new Error('Only Supreme Admin or Owner can publish campus events.');
  }
  const validationError = validateCampusEventFormInput(input.form);
  if (validationError) {
    throw new Error(validationError);
  }

  const eventId = generateFirestoreDocId(COLLECTION_NAMES.events);
  const eventMs = Date.parse(input.form.eventDateIso);
  const status: CampusEventStatus = categorizeEventByDate(
    eventMs,
    Date.now(),
    input.form.status ?? 'upcoming'
  );

  const payload: Record<string, unknown> = {
    id: eventId,
    ownerUID: input.actorUid,
    title: input.form.title.trim(),
    description: input.form.description.trim(),
    eventDate: Timestamp.fromMillis(eventMs),
    venue: input.form.venue.trim(),
    organiser: input.form.organiser.trim(),
    status,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (input.form.timeLabel?.trim()) {
    payload.timeLabel = input.form.timeLabel.trim().slice(0, 64);
  }
  if (input.form.registrationUrl?.trim()) {
    payload.registrationUrl = input.form.registrationUrl.trim().slice(0, 512);
  }
  if (input.form.onlineMeetingUrl?.trim()) {
    payload.onlineMeetingUrl = input.form.onlineMeetingUrl.trim().slice(0, 512);
  }
  if (input.form.instructions?.trim()) {
    payload.instructions = input.form.instructions.trim().slice(0, 2000);
  }

  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTION_NAMES.events, eventId), payload);
  attachAdminAuditLogToBatch(batch, {
    action: 'event_created',
    targetCollection: COLLECTION_NAMES.events,
    targetId: eventId,
    targetLabel: input.form.title.trim(),
    performedByUid: input.actorUid,
    performedByRole: input.actorRole,
    details: `${input.form.venue.trim()} · ${input.form.organiser.trim()}`,
  });

  try {
    await batch.commit();
    return {
      ...(payload as unknown as CampusEvent),
      eventDate: eventMs,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `${COLLECTION_NAMES.events}/${eventId}`
    );
  }
}

export async function updateCampusEventRecord(input: {
  existing: CampusEvent;
  form: CampusEventFormInput;
  actorUid: string;
  actorRole: UserRole;
}): Promise<CampusEvent> {
  if (input.actorRole !== 'owner' && input.actorRole !== 'supreme_admin') {
    throw new Error('Only Supreme Admin or Owner can edit campus events.');
  }
  const validationError = validateCampusEventFormInput(input.form);
  if (validationError) {
    throw new Error(validationError);
  }

  const eventMs = Date.parse(input.form.eventDateIso);
  const status: CampusEventStatus =
    input.form.status === 'cancelled'
      ? 'cancelled'
      : categorizeEventByDate(eventMs, Date.now(), input.form.status ?? 'upcoming');

  const updates: Record<
    string,
    FieldValue | string | number | boolean | Timestamp | undefined
  > = {
    title: input.form.title.trim(),
    description: input.form.description.trim(),
    eventDate: Timestamp.fromMillis(eventMs),
    venue: input.form.venue.trim(),
    organiser: input.form.organiser.trim(),
    timeLabel: input.form.timeLabel?.trim()
      ? input.form.timeLabel.trim().slice(0, 64)
      : deleteField(),
    registrationUrl: input.form.registrationUrl?.trim()
      ? input.form.registrationUrl.trim().slice(0, 512)
      : deleteField(),
    onlineMeetingUrl: input.form.onlineMeetingUrl?.trim()
      ? input.form.onlineMeetingUrl.trim().slice(0, 512)
      : deleteField(),
    instructions: input.form.instructions?.trim()
      ? input.form.instructions.trim().slice(0, 2000)
      : deleteField(),
    status,
    updatedAt: serverTimestamp(),
  };

  const batch = writeBatch(db);
  batch.update(doc(db, COLLECTION_NAMES.events, input.existing.id), updates);
  attachAdminAuditLogToBatch(batch, {
    action:
      status === 'cancelled' && input.existing.status !== 'cancelled'
        ? 'event_cancelled'
        : 'event_updated',
    targetCollection: COLLECTION_NAMES.events,
    targetId: input.existing.id,
    targetLabel: input.form.title.trim(),
    performedByUid: input.actorUid,
    performedByRole: input.actorRole,
    details: `Event status: ${status}`,
  });

  try {
    await batch.commit();
    return {
      ...input.existing,
      title: input.form.title.trim(),
      description: input.form.description.trim(),
      eventDate: eventMs,
      venue: input.form.venue.trim(),
      organiser: input.form.organiser.trim(),
      timeLabel: input.form.timeLabel?.trim() || undefined,
      registrationUrl: input.form.registrationUrl?.trim() || undefined,
      onlineMeetingUrl: input.form.onlineMeetingUrl?.trim() || undefined,
      instructions: input.form.instructions?.trim() || undefined,
      status,
      updatedAt: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `${COLLECTION_NAMES.events}/${input.existing.id}`
    );
  }
}

export async function deleteCampusEventRecord(input: {
  event: CampusEvent;
  actorUid: string;
  actorRole: UserRole;
}): Promise<void> {
  if (input.actorRole !== 'owner' && input.actorRole !== 'supreme_admin') {
    throw new Error('Only Supreme Admin or Owner can remove campus events.');
  }
  const batch = writeBatch(db);
  batch.delete(doc(db, COLLECTION_NAMES.events, input.event.id));
  attachAdminAuditLogToBatch(batch, {
    action: 'event_deleted',
    targetCollection: COLLECTION_NAMES.events,
    targetId: input.event.id,
    targetLabel: input.event.title,
    performedByUid: input.actorUid,
    performedByRole: input.actorRole,
    details: `Removed campus event (${input.event.venue})`,
  });
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.DELETE,
      `${COLLECTION_NAMES.events}/${input.event.id}`
    );
  }
}

export async function updateTrustedContactWithAudit(input: {
  existing: TrustedContact;
  fullName: string;
  category: TrustedContactCategory;
  roleTitle: string;
  department?: string;
  faculty?: string;
  contactNumber?: string;
  whatsappLink?: string;
  description?: string;
  actorUid: string;
  actorRole: UserRole;
}): Promise<TrustedContact> {
  if (input.actorRole !== 'owner' && input.actorRole !== 'supreme_admin') {
    throw new Error('Only Supreme Admin or Owner can update Trusted Circle contacts.');
  }
  const cleanName = input.fullName.trim();
  const cleanRoleTitle = input.roleTitle.trim();
  const cleanWhatsapp = input.whatsappLink?.trim() || undefined;
  if (cleanWhatsapp && !isSafeMediaUrl(cleanWhatsapp)) {
    throw new Error('WhatsApp link must start with https:// or http://.');
  }

  const nextRecord: TrustedContact = {
    ...input.existing,
    entryType: 'admin_listed_contact',
    isUserAccount: false,
    fullName: cleanName,
    category: input.category,
    roleTitle: cleanRoleTitle,
    department: input.department?.trim() || undefined,
    faculty: input.faculty?.trim() || undefined,
    contactNumber: input.contactNumber?.trim() || undefined,
    whatsappLink: cleanWhatsapp,
    description: input.description?.trim() || undefined,
    updatedAt: Date.now(),
  };

  validateTrustedContactPayload(nextRecord);

  const batch = writeBatch(db);
  batch.update(doc(db, COLLECTION_NAMES.trustedContacts, input.existing.id), {
    fullName: cleanName,
    category: input.category,
    roleTitle: cleanRoleTitle,
    department: nextRecord.department ?? deleteField(),
    faculty: nextRecord.faculty ?? deleteField(),
    contactNumber: nextRecord.contactNumber ?? deleteField(),
    whatsappLink: nextRecord.whatsappLink ?? deleteField(),
    description: nextRecord.description ?? deleteField(),
    updatedAt: serverTimestamp(),
  });
  attachAdminAuditLogToBatch(batch, {
    action: 'trusted_contact_updated',
    targetCollection: COLLECTION_NAMES.trustedContacts,
    targetId: input.existing.id,
    targetLabel: cleanName,
    performedByUid: input.actorUid,
    performedByRole: input.actorRole,
    details: `${input.category} · ${cleanRoleTitle}`,
  });

  try {
    await batch.commit();
    return nextRecord;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `${COLLECTION_NAMES.trustedContacts}/${input.existing.id}`
    );
  }
}

export async function createTrustedContactWithAudit(input: {
  fullName: string;
  category: TrustedContactCategory;
  roleTitle: string;
  department?: string;
  faculty?: string;
  contactNumber?: string;
  whatsappLink?: string;
  description?: string;
  actorUid: string;
  actorRole: UserRole;
}): Promise<TrustedContact> {
  if (input.actorRole !== 'owner' && input.actorRole !== 'supreme_admin') {
    throw new Error('Only Supreme Admin or Owner can add Trusted Circle contacts.');
  }

  const contactId = generateFirestoreDocId(COLLECTION_NAMES.trustedContacts);
  const cleanName = input.fullName.trim();
  const cleanRoleTitle = input.roleTitle.trim();
  const cleanWhatsapp = input.whatsappLink?.trim() || undefined;
  if (cleanWhatsapp && !isSafeMediaUrl(cleanWhatsapp)) {
    throw new Error('WhatsApp link must start with https:// or http://.');
  }

  const record: TrustedContact = {
    id: contactId,
    entryType: 'admin_listed_contact',
    isUserAccount: false,
    fullName: cleanName,
    category: input.category,
    roleTitle: cleanRoleTitle,
    department: input.department?.trim() || undefined,
    faculty: input.faculty?.trim() || undefined,
    contactNumber: input.contactNumber?.trim() || undefined,
    whatsappLink: cleanWhatsapp,
    description: input.description?.trim() || undefined,
    createdByUid: input.actorUid,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  validateTrustedContactPayload(record);

  const firestorePayload: Record<string, unknown> = {
    id: contactId,
    entryType: 'admin_listed_contact',
    isUserAccount: false,
    fullName: cleanName,
    category: input.category,
    roleTitle: cleanRoleTitle,
    createdByUid: input.actorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (record.department) firestorePayload.department = record.department;
  if (record.faculty) firestorePayload.faculty = record.faculty;
  if (record.contactNumber) firestorePayload.contactNumber = record.contactNumber;
  if (record.whatsappLink) firestorePayload.whatsappLink = record.whatsappLink;
  if (record.description) firestorePayload.description = record.description;

  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTION_NAMES.trustedContacts, contactId), firestorePayload);
  attachAdminAuditLogToBatch(batch, {
    action: 'trusted_contact_created',
    targetCollection: COLLECTION_NAMES.trustedContacts,
    targetId: contactId,
    targetLabel: cleanName,
    performedByUid: input.actorUid,
    performedByRole: input.actorRole,
    details: `${input.category} · ${cleanRoleTitle}`,
  });

  try {
    await batch.commit();
    return record;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `${COLLECTION_NAMES.trustedContacts}/${contactId}`
    );
  }
}

export async function deleteTrustedContactWithAudit(input: {
  contact: TrustedContact;
  actorUid: string;
  actorRole: UserRole;
}): Promise<void> {
  if (input.actorRole !== 'owner' && input.actorRole !== 'supreme_admin') {
    throw new Error('Only Supreme Admin or Owner can remove Trusted Circle contacts.');
  }
  const batch = writeBatch(db);
  batch.delete(doc(db, COLLECTION_NAMES.trustedContacts, input.contact.id));
  attachAdminAuditLogToBatch(batch, {
    action: 'trusted_contact_deleted',
    targetCollection: COLLECTION_NAMES.trustedContacts,
    targetId: input.contact.id,
    targetLabel: input.contact.fullName,
    performedByUid: input.actorUid,
    performedByRole: input.actorRole,
    details: `Removed ${input.contact.roleTitle}`,
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.DELETE,
      `${COLLECTION_NAMES.trustedContacts}/${input.contact.id}`
    );
  }
}

export async function fetchAdminAuditLogs(maxItems = 80): Promise<AdminAuditLog[]> {
  try {
    const snap = await getDocs(
      query(collection(db, COLLECTION_NAMES.adminAuditLogs), limit(maxItems))
    );
    return sortByCreatedAtDesc(
      snap.docs.map((item) => item.data() as AdminAuditLog)
    );
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.LIST,
      COLLECTION_NAMES.adminAuditLogs
    );
  }
}

export async function fetchUnifiedAuditLogFeed(
  maxItems = 100
): Promise<UnifiedAuditEntry[]> {
  const [badgeLogs, adminLogs, anonLogs] = await Promise.all([
    fetchBadgeAuditLogs(maxItems),
    fetchAdminAuditLogs(maxItems),
    fetchAnonymousAuditLogs(maxItems),
  ]);

  return [
    ...badgeLogs.map((data) => ({
      kind: 'badge' as const,
      id: `badge_${data.id}`,
      createdAt: data.createdAt,
      data,
    })),
    ...adminLogs.map((data) => ({
      kind: 'admin' as const,
      id: `admin_${data.id}`,
      createdAt: data.createdAt,
      data,
    })),
    ...anonLogs.map((data) => ({
      kind: 'anonymous_reveal' as const,
      id: `anon_${data.id}`,
      createdAt: data.createdAt,
      data,
    })),
  ]
    .sort((a, b) => {
      const aMs = extractTimestampMs(a.createdAt) ?? 0;
      const bMs = extractTimestampMs(b.createdAt) ?? 0;
      return bMs - aMs;
    })
    .slice(0, maxItems);
}

export async function fetchGlobalPlatformSettings(): Promise<PlatformSetting | null> {
  try {
    const snap = await getDoc(
      doc(db, COLLECTION_NAMES.platformSettings, 'global')
    );
    return snap.exists() ? (snap.data() as PlatformSetting) : null;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.GET,
      `${COLLECTION_NAMES.platformSettings}/global`
    );
  }
}

export async function saveGlobalPlatformSettings(input: {
  actorUid: string;
  actorRole: UserRole;
  maintenanceNotice: string;
  pinnedAnnouncementPostId: string;
  marketplaceSubmissionsOpen: boolean;
  anonymousPostingOpen: boolean;
  newRegistrationsOpen: boolean;
}): Promise<PlatformSetting> {
  if (input.actorRole !== 'owner' && input.actorRole !== 'supreme_admin') {
    throw new Error('Only Supreme Admin or Owner can update platform settings.');
  }

  const cleanNotice = input.maintenanceNotice.trim().slice(0, 400);
  const cleanPinnedId = input.pinnedAnnouncementPostId.trim().slice(0, 128);
  if (cleanPinnedId && !isValidFirestoreId(cleanPinnedId)) {
    throw new Error(
      'Pinned announcement post ID may contain only letters, numbers, underscores, or hyphens.'
    );
  }

  const payload: Record<string, unknown> = {
    id: 'global',
    updatedByUid: input.actorUid,
    marketplaceSubmissionsOpen: Boolean(input.marketplaceSubmissionsOpen),
    anonymousPostingOpen: Boolean(input.anonymousPostingOpen),
    newRegistrationsOpen: Boolean(input.newRegistrationsOpen),
    updatedAt: serverTimestamp(),
  };

  if (cleanNotice) {
    payload.maintenanceNotice = cleanNotice;
  }
  if (cleanPinnedId) {
    payload.pinnedAnnouncementPostId = cleanPinnedId;
  }

  const settingRef = doc(db, COLLECTION_NAMES.platformSettings, 'global');
  try {
    await runTransaction(db, async (tx) => {
      const existingSnap = await tx.get(settingRef);
      if (existingSnap.exists()) {
        tx.update(settingRef, {
          updatedByUid: input.actorUid,
          maintenanceNotice: cleanNotice || deleteField(),
          pinnedAnnouncementPostId: cleanPinnedId || deleteField(),
          marketplaceSubmissionsOpen: Boolean(input.marketplaceSubmissionsOpen),
          anonymousPostingOpen: Boolean(input.anonymousPostingOpen),
          newRegistrationsOpen: Boolean(input.newRegistrationsOpen),
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(settingRef, payload);
      }
    });

    await recordAdminAuditLog({
      action: 'settings_updated',
      targetCollection: COLLECTION_NAMES.platformSettings,
      targetId: 'global',
      targetLabel: 'Global Platform Settings',
      performedByUid: input.actorUid,
      performedByRole: input.actorRole,
      details: `marketplace=${String(input.marketplaceSubmissionsOpen)}, anonymous=${String(input.anonymousPostingOpen)}, registrations=${String(input.newRegistrationsOpen)}`,
    }).catch(() => undefined);

    return {
      id: 'global',
      updatedByUid: input.actorUid,
      maintenanceNotice: cleanNotice || undefined,
      pinnedAnnouncementPostId: cleanPinnedId || undefined,
      marketplaceSubmissionsOpen: Boolean(input.marketplaceSubmissionsOpen),
      anonymousPostingOpen: Boolean(input.anonymousPostingOpen),
      newRegistrationsOpen: Boolean(input.newRegistrationsOpen),
      updatedAt: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `${COLLECTION_NAMES.platformSettings}/global`
    );
  }
}
