import type { CommunityPost } from '../types/database';
import { extractTimestampMs } from './contextualSearch';

/**
 * Latest feed: strictly newest-first chronological ordering (createdAt DESC),
 * without pinned-first reordering.
 */
export function sortLatestCommunityPosts(
  posts: readonly CommunityPost[]
): CommunityPost[] {
  return posts
    .filter((post) => post.status === 'published')
    .sort((a, b) => {
      const aMs = extractTimestampMs(a.createdAt) ?? 0;
      const bMs = extractTimestampMs(b.createdAt) ?? 0;
      if (bMs !== aMs) {
        return bMs - aMs;
      }
      return b.id.localeCompare(a.id);
    });
}

export interface ForYouRankingOptions {
  followedUids?: ReadonlySet<string>;
  nowMs?: number;
}

/**
 * Computes a transparent, deterministic relevance score using only real existing
 * post fields (pin status, official flag, followed-author affinity, real like and
 * comment counts, and freshness decay). No invented engagement metrics.
 */
export function computeForYouPostScore(
  post: CommunityPost,
  options: ForYouRankingOptions = {}
): number {
  const nowMs = options.nowMs ?? Date.now();
  const createdMs = extractTimestampMs(post.createdAt) ?? nowMs;
  const ageHours = Math.max(0, (nowMs - createdMs) / (1000 * 60 * 60));

  // Freshness starts at 100 and decays smoothly over time
  const freshnessScore = 100 / Math.pow(1 + ageHours / 18, 1.15);

  const pinnedBoost = post.isPinned ? 500 : 0;
  const officialBoost = post.isOfficial ? 60 : 0;
  const followedBoost = options.followedUids?.has(post.ownerUID) ? 45 : 0;

  const likes = Number.isFinite(post.likesCount)
    ? Math.max(0, post.likesCount)
    : 0;
  const comments = Number.isFinite(post.commentsCount)
    ? Math.max(0, post.commentsCount)
    : 0;

  // Bounded log-style dampening so high-count older posts don't crowd out fresh updates
  const engagementScore =
    Math.min(40, Math.sqrt(likes) * 4) + Math.min(50, Math.sqrt(comments) * 6);

  return pinnedBoost + officialBoost + followedBoost + engagementScore + freshnessScore;
}

export function rankForYouCommunityPosts(
  posts: readonly CommunityPost[],
  options: ForYouRankingOptions = {}
): CommunityPost[] {
  return posts
    .filter((post) => post.status === 'published')
    .sort((a, b) => {
      const scoreDiff =
        computeForYouPostScore(b, options) - computeForYouPostScore(a, options);
      if (Math.abs(scoreDiff) > 0.0001) {
        return scoreDiff;
      }
      const aMs = extractTimestampMs(a.createdAt) ?? 0;
      const bMs = extractTimestampMs(b.createdAt) ?? 0;
      return bMs - aMs;
    });
}
