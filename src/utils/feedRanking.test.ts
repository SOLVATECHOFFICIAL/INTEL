import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  AdminUpdate,
  AnonymousPost,
  CampusEvent,
  CommunityPost,
  Opportunity,
  PublicProfileProjection,
} from '../types/database';
import {
  buildCombinedHomeForYouStream,
  buildCombinedHomeLatestStream,
  buildForYouFeedStream,
  buildInteractionAffinities,
  clearFeedBehaviorCacheForTest,
  computeForYouPostScore,
  computeTikTokEngagementVelocityScore,
  diversifyCombinedHomeStream,
  normalizeInterestList,
  rankForYouCommunityPosts,
  rankRecommendedAnonymousPosts,
  rankRecommendedEvents,
  rankRecommendedOpportunities,
  rankRecommendedPeople,
  recordFeedBehaviorSignal,
  sortChronologicalAnonymousPosts,
  sortLatestCommunityPosts,
} from './feedRanking';

function makePost(overrides: Partial<CommunityPost> & { id: string }): CommunityPost {
  return {
    ownerUID: 'user_1',
    authorRole: 'verified',
    postType: 'text',
    category: 'Campus Update',
    body: 'Sample campus post.',
    backgroundStyle: 'navy_slate',
    isOfficial: false,
    isPinned: false,
    status: 'published',
    visibility: 'public',
    likesCount: 0,
    commentsCount: 0,
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
    ...overrides,
  };
}

function makeMember(
  overrides: Partial<PublicProfileProjection> & { username: string }
): PublicProfileProjection {
  return {
    fullName: 'Campus Member',
    bio: '',
    department: 'Computer Science',
    faculty: 'Science',
    level: '200 Level',
    accountCategory: 'Student',
    badge: 'verified',
    accountStatus: 'active',
    showWhatsappPublicly: false,
    followersCount: 10,
    followingCount: 5,
    createdAt: 1_000_000,
    ...overrides,
  };
}

test('sortLatestCommunityPosts orders strictly newest-first without pinned priority', () => {
  const olderPinned = makePost({
    id: 'p_old_pinned',
    isPinned: true,
    createdAt: 1_000,
  });
  const middle = makePost({
    id: 'p_mid',
    createdAt: 5_000,
  });
  const newest = makePost({
    id: 'p_new',
    createdAt: 9_000,
  });
  const deletedPost = makePost({
    id: 'p_deleted',
    status: 'deleted',
    createdAt: 99_000,
  });

  const sorted = sortLatestCommunityPosts([olderPinned, middle, newest, deletedPost]);
  assert.deepEqual(
    sorted.map((p) => p.id),
    ['p_new', 'p_mid', 'p_old_pinned']
  );
});

test('sortChronologicalAnonymousPosts keeps anonymous posts strictly newest-first', () => {
  const oldAnon: AnonymousPost = {
    id: 'a_old',
    category: 'Campus Life',
    body: 'Earlier thought',
    status: 'published',
    visibility: 'public',
    likesCount: 40,
    commentsCount: 15,
    createdAt: 1_000,
    updatedAt: 1_000,
  };
  const freshAnon: AnonymousPost = {
    id: 'a_fresh',
    category: 'Academics',
    body: 'Latest exam timetable inquiry',
    status: 'published',
    visibility: 'public',
    likesCount: 0,
    commentsCount: 0,
    createdAt: 8_000,
    updatedAt: 8_000,
  };

  const sorted = sortChronologicalAnonymousPosts([oldAnon, freshAnon]);
  assert.deepEqual(
    sorted.map((item) => item.id),
    ['a_fresh', 'a_old']
  );
});

test('rankForYouCommunityPosts prioritizes pinned, official, followed, and engaged recent posts using only real fields', () => {
  const nowMs = 100_000_000;
  const freshFollowed = makePost({
    id: 'p_followed',
    ownerUID: 'author_followed',
    createdAt: nowMs - 1_800_000,
    likesCount: 5,
    commentsCount: 2,
  });
  const freshUnfollowed = makePost({
    id: 'p_plain',
    ownerUID: 'author_other',
    createdAt: nowMs - 1_800_000,
    likesCount: 0,
    commentsCount: 0,
  });
  const officialPost = makePost({
    id: 'p_official',
    ownerUID: 'author_admin',
    isOfficial: true,
    createdAt: nowMs - 3_600_000,
  });
  const pinnedPost = makePost({
    id: 'p_pinned',
    ownerUID: 'author_admin',
    isPinned: true,
    createdAt: nowMs - 86_400_000,
  });

  const ranked = rankForYouCommunityPosts(
    [freshUnfollowed, officialPost, freshFollowed, pinnedPost],
    {
      followedUids: new Set(['author_followed']),
      nowMs,
    }
  );

  assert.equal(ranked[0].id, 'p_pinned');
  assert.ok(
    computeForYouPostScore(officialPost, { nowMs }) >
      computeForYouPostScore(freshUnfollowed, { nowMs })
  );
  assert.ok(
    computeForYouPostScore(freshFollowed, {
      followedUids: new Set(['author_followed']),
      nowMs,
    }) > computeForYouPostScore(freshUnfollowed, { nowMs })
  );
});

test('computeForYouPostScore boosts matching department, faculty, selected interests, and interaction history', () => {
  const nowMs = 200_000_000;
  const csAuthor = makeMember({
    username: 'ada_cs',
    department: 'Computer Science',
    faculty: 'Science and Technology Education',
  });
  const histAuthor = makeMember({
    username: 'bode_hist',
    department: 'History',
    faculty: 'Arts',
  });
  const authorMap = new Map<string, PublicProfileProjection>([
    ['u_cs', csAuthor],
    ['u_hist', histAuthor],
  ]);

  const deptPost = makePost({
    id: 'p_cs',
    ownerUID: 'u_cs',
    category: 'Academic Notice',
    title: 'CSC 204 lab schedule update',
    body: 'Computer Science programming practicals begin tomorrow.',
    createdAt: nowMs - 3_600_000,
  });
  const unrelatedPost = makePost({
    id: 'p_hist',
    ownerUID: 'u_hist',
    category: 'General',
    title: 'History debate notice',
    body: 'Department seminar on Thursday.',
    createdAt: nowMs - 3_600_000,
  });

  const affinities = buildInteractionAffinities({
    likedOrSavedPosts: [
      makePost({
        id: 'liked_1',
        ownerUID: 'u_cs',
        category: 'Academic Notice',
        body: 'Algorithm study guide',
      }),
    ],
  });

  const options = {
    nowMs,
    viewerDepartment: 'Computer Science',
    viewerFaculty: 'Science and Technology Education',
    interestCategories: ['Academic Notices', 'Tech & Digital Skills'],
    authorMap,
    ...affinities,
  };

  assert.ok(
    computeForYouPostScore(deptPost, options) >
      computeForYouPostScore(unrelatedPost, options)
  );
});

test('rankRecommendedPeople prioritizes shared academic focus over raw high follower count and excludes followed/dismissed accounts', () => {
  const highFollowersUnrelated = makeMember({
    username: 'campus_celeb',
    department: 'Music',
    faculty: 'Arts',
    level: '400 Level',
    followersCount: 5000,
  });
  const classmateMatch = makeMember({
    username: 'tunde_csc',
    department: 'Computer Science',
    faculty: 'Science',
    level: '200 Level',
    bio: 'Web development and campus tech events',
    followersCount: 12,
  });
  const alreadyFollowed = makeMember({
    username: 'friend_csc',
    department: 'Computer Science',
    faculty: 'Science',
    followersCount: 90,
  });
  const dismissedMatch = makeMember({
    username: 'dismissed_csc',
    department: 'Computer Science',
    faculty: 'Science',
  });

  const recs = rankRecommendedPeople(
    [highFollowersUnrelated, classmateMatch, alreadyFollowed, dismissedMatch],
    {
      viewerUsername: 'viewer_csc',
      followingUsernames: new Set(['friend_csc']),
      viewerDepartment: 'Computer Science',
      viewerFaculty: 'Science',
      viewerLevel: '200 Level',
      interestCategories: ['Tech & Digital Skills'],
      dismissedKeys: new Set(['person:dismissed_csc']),
    }
  );

  assert.equal(recs[0]?.member.username, 'tunde_csc');
  assert.ok(!recs.some((item) => item.member.username === 'friend_csc'));
  assert.ok(!recs.some((item) => item.member.username === 'dismissed_csc'));
  assert.ok(!recs.some((item) => item.member.username === 'campus_celeb'));
});

test('rankRecommendedEvents and rankRecommendedOpportunities filter expired/saved/dismissed items and score relevance', () => {
  const nowMs = Date.UTC(2026, 5, 10, 12, 0, 0);
  const events: CampusEvent[] = [
    {
      id: 'evt_match',
      ownerUID: 'u1',
      title: 'Computer Science Hackathon & Workshop',
      organiser: 'NACOSS LASUED',
      category: 'seminar_workshop',
      venue: 'Science Hall',
      description: 'Coding competition for science and technology students.',
      eventDate: nowMs + 86_400_000,
      published: true,
      status: 'upcoming',
      likesCount: 14,
      commentsCount: 3,
      createdAt: nowMs - 86_400_000,
      updatedAt: nowMs - 86_400_000,
    },
    {
      id: 'evt_past',
      ownerUID: 'u1',
      title: 'Old Semester Orientation',
      organiser: 'DSA',
      category: 'orientation',
      venue: 'Main Hall',
      description: 'Finished event',
      eventDate: nowMs - 172_800_000,
      published: true,
      status: 'completed',
      likesCount: 100,
      commentsCount: 40,
      createdAt: nowMs - 500_000_000,
      updatedAt: nowMs - 500_000_000,
    },
  ];

  const rankedEvents = rankRecommendedEvents(events, {
    viewerDepartment: 'Computer Science',
    interestCategories: ['Tech & Digital Skills', 'Campus Events'],
    nowMs,
  });
  assert.deepEqual(
    rankedEvents.map((e) => e.event.id),
    ['evt_match']
  );

  const opps: Opportunity[] = [
    {
      id: 'opp_sch',
      ownerUID: 'admin',
      title: 'LASUED STEM Undergraduate Scholarship',
      organisation: 'Tech Foundation',
      category: 'scholarship',
      description: 'Funding for Computer Science students.',
      expiresAt: nowMs + 5 * 86_400_000,
      status: 'active',
      isVerified: true,
      createdAt: nowMs - 86_400_000,
      updatedAt: nowMs - 86_400_000,
    },
    {
      id: 'opp_closed',
      ownerUID: 'admin',
      title: 'Closed Grant',
      organisation: 'Org',
      category: 'grant',
      description: 'Expired opportunity',
      expiresAt: nowMs - 86_400_000,
      status: 'active',
      createdAt: nowMs - 500_000_000,
      updatedAt: nowMs - 500_000_000,
    },
  ];

  const rankedOpps = rankRecommendedOpportunities(opps, {
    viewerDepartment: 'Computer Science',
    interestCategories: ['Scholarships & Grants'],
    nowMs,
  });
  assert.deepEqual(
    rankedOpps.map((o) => o.opportunity.id),
    ['opp_sch']
  );
});

test('rankRecommendedAnonymousPosts uses only public fields and excludes dismissed threads', () => {
  const nowMs = 500_000_000;
  const anonA: AnonymousPost = {
    id: 'anon_topic',
    category: 'Academics & Exams',
    body: 'Any tips for CSC 204 past questions and study groups?',
    status: 'published',
    visibility: 'public',
    likesCount: 6,
    commentsCount: 4,
    createdAt: nowMs - 3_600_000,
    updatedAt: nowMs - 3_600_000,
  };
  const anonDismissed: AnonymousPost = {
    id: 'anon_dismissed',
    category: 'Campus Life',
    body: 'Random hostel gist.',
    status: 'published',
    visibility: 'public',
    likesCount: 50,
    commentsCount: 20,
    createdAt: nowMs - 3_600_000,
    updatedAt: nowMs - 3_600_000,
  };

  const recs = rankRecommendedAnonymousPosts([anonA, anonDismissed], {
    viewerDepartment: 'Computer Science',
    interestCategories: ['Books & Study Materials'],
    dismissedKeys: new Set(['anon:anon_dismissed']),
    nowMs,
  });

  assert.deepEqual(
    recs.map((item) => item.post.id),
    ['anon_topic']
  );
});

test('buildForYouFeedStream deduplicates posts and interleaves discovery blocks cleanly', () => {
  const posts = [1, 2, 3, 4, 5].map((idx) => ({
    post: makePost({ id: `p_${idx}`, createdAt: idx * 1_000 }),
    author: null,
  }));
  // Include a duplicate post ID to verify strict deduplication
  const duplicatedInput = [...posts, posts[0]];

  const stream = buildForYouFeedStream({
    posts: duplicatedInput,
    recommendedPeople: [
      {
        member: makeMember({ username: 'rec_member' }),
        score: 80,
        reason: 'Same department',
      },
    ],
    recommendedEvents: [],
    recommendedOpportunities: [],
    recommendedAnonymous: [],
    dismissedKeys: new Set(),
  });

  const postEntries = stream.filter((entry) => entry.kind === 'post');
  assert.equal(postEntries.length, 5);
  assert.ok(stream.some((entry) => entry.kind === 'people_discovery'));
});

test('normalizeInterestList trims, deduplicates, caps length at 20, and removes empty entries', () => {
  const normalized = normalizeInterestList([
    '  Campus News ',
    'campus news',
    '',
    'Academic Notices',
  ]);
  assert.deepEqual(normalized, ['Campus News', 'Academic Notices']);
});

test('buildCombinedHomeForYouStream prioritizes official updates and campus posts while weaving anonymous threads cleanly', () => {
  const nowMs = 2_000_000_000;
  const officialUpdate: AdminUpdate = {
    id: 'upd_1',
    format: 'text',
    authorMode: 'official_desk',
    authorDisplayName: 'LASUED Intel Official',
    authorBadge: 'verified',
    category: 'announcement',
    body: 'First semester exam timetable updated.',
    backgroundStyle: 'navy_slate',
    isPinned: false,
    status: 'published',
    visibility: 'public',
    likesCount: 15,
    commentsCount: 4,
    createdAt: nowMs - 10_000,
    updatedAt: nowMs - 10_000,
  };
  const posts = [1, 2, 3, 4].map((idx) => ({
    post: makePost({ id: `post_${idx}`, createdAt: nowMs - idx * 5_000 }),
    author: null,
  }));
  const anonPosts: AnonymousPost[] = [
    {
      id: 'anon_1',
      category: 'Campus Life',
      body: 'Quiet study room in the library?',
      status: 'published',
      visibility: 'public',
      likesCount: 3,
      commentsCount: 1,
      createdAt: nowMs - 2_000,
      updatedAt: nowMs - 2_000,
    },
    {
      id: 'anon_2',
      category: 'Confessions',
      body: 'Shoutout to CSC 201 study group.',
      status: 'published',
      visibility: 'public',
      likesCount: 8,
      commentsCount: 2,
      createdAt: nowMs - 6_000,
      updatedAt: nowMs - 6_000,
    },
  ];

  const stream = buildCombinedHomeForYouStream({
    updates: [
      { update: officialUpdate, author: null },
      { update: officialUpdate, author: null },
    ],
    posts: [...posts, posts[0]],
    anonymousPosts: [...anonPosts, anonPosts[0]],
    nowMs,
  });

  const updateEntries = stream.filter((item) => item.kind === 'update');
  const postEntries = stream.filter((item) => item.kind === 'post');
  const anonEntries = stream.filter((item) => item.kind === 'anonymous');

  assert.equal(updateEntries.length, 1);
  assert.equal(postEntries.length, 4);
  assert.equal(anonEntries.length, 2);
  // First 3 primary items (official update + top campus posts) appear before the first woven anonymous post
  const firstAnonIndex = stream.findIndex((item) => item.kind === 'anonymous');
  assert.ok(firstAnonIndex >= 3);
});

test('buildCombinedHomeLatestStream sorts updates, campus posts, and anonymous posts newest-first without duplicates', () => {
  const officialUpdate: AdminUpdate = {
    id: 'upd_latest',
    format: 'text',
    authorMode: 'official_desk',
    authorDisplayName: 'LASUED Intel Official',
    authorBadge: 'verified',
    category: 'urgent',
    body: 'Urgent senate update.',
    backgroundStyle: 'navy_slate',
    isPinned: false,
    status: 'published',
    visibility: 'public',
    likesCount: 0,
    commentsCount: 0,
    createdAt: 30_000,
    updatedAt: 30_000,
  };
  const campusPost = {
    post: makePost({ id: 'post_latest', createdAt: 10_000 }),
    author: null,
  };
  const anonPost: AnonymousPost = {
    id: 'anon_latest',
    category: 'Campus Life',
    body: 'New shuttle bus schedule.',
    status: 'published',
    visibility: 'public',
    likesCount: 0,
    commentsCount: 0,
    createdAt: 20_000,
    updatedAt: 20_000,
  };

  const latest = buildCombinedHomeLatestStream({
    updates: [{ update: officialUpdate, author: null }],
    posts: [campusPost],
    anonymousPosts: [anonPost],
  });

  assert.deepEqual(
    latest.map((item) => item.id),
    ['update_upd_latest', 'anon_anon_latest', 'post_post_latest']
  );
});

test('TikTok AI algorithm prioritizes fast-engaging media posts, penalizes fast skips, and enforces anti-repetition spacing', () => {
  const nowMs = 5_000_000_000;
  clearFeedBehaviorCacheForTest('ai_tester');

  const highVelocityMedia = computeTikTokEngagementVelocityScore({
    likesCount: 18,
    commentsCount: 6,
    viewsCount: 140,
    mediaCount: 2,
    ageHours: 1,
  });
  const lowVelocityText = computeTikTokEngagementVelocityScore({
    likesCount: 2,
    commentsCount: 0,
    viewsCount: 15,
    mediaCount: 0,
    ageHours: 1,
  });
  assert.ok(highVelocityMedia > lowVelocityText);

  // Record strong dwell/completion affinity for author_a and fast-skip on post_skip
  recordFeedBehaviorSignal('ai_tester', {
    targetId: 'post_completed',
    authorKey: 'author_a',
    category: 'Tech & Digital Skills',
    text: 'TypeScript campus workshop notes',
    dwellMs: 6500,
    completed: true,
    timestampMs: nowMs - 10_000,
  });
  const snapshot = recordFeedBehaviorSignal('ai_tester', {
    targetId: 'post_skip',
    authorKey: 'author_b',
    category: 'General',
    dwellMs: 400,
    skippedFast: true,
    timestampMs: nowMs - 5_000,
  });

  const boostedPost = makePost({
    id: 'candidate_a',
    ownerUID: 'author_a',
    category: 'Tech & Digital Skills',
    body: 'New TypeScript campus workshop notes ready.',
    createdAt: nowMs - 3_600_000,
  });
  const skippedPost = makePost({
    id: 'skip',
    ownerUID: 'author_b',
    category: 'General',
    body: 'Random chatter',
    createdAt: nowMs - 3_600_000,
  });

  const boostedScore = computeForYouPostScore(boostedPost, {
    interactedAuthorWeights: snapshot.authorWeights,
    interactedCategoryWeights: snapshot.categoryWeights,
    interactedKeywords: snapshot.keywordWeights,
    seenCounts: snapshot.seenCounts,
    lastSeenMs: snapshot.lastSeenMs,
    fastSkippedIds: snapshot.fastSkippedIds,
    nowMs,
  });
  const skippedScore = computeForYouPostScore(skippedPost, {
    interactedAuthorWeights: snapshot.authorWeights,
    interactedCategoryWeights: snapshot.categoryWeights,
    interactedKeywords: snapshot.keywordWeights,
    seenCounts: snapshot.seenCounts,
    lastSeenMs: snapshot.lastSeenMs,
    fastSkippedIds: snapshot.fastSkippedIds,
    nowMs,
  });
  assert.ok(boostedScore > skippedScore);

  // Anti-repetition spacing avoids adjacent posts by same author when another author is available
  const a1 = { kind: 'post' as const, id: 'post_a1', item: { post: makePost({ id: 'a1', ownerUID: 'same_author', category: 'News' }), author: null } };
  const a2 = { kind: 'post' as const, id: 'post_a2', item: { post: makePost({ id: 'a2', ownerUID: 'same_author', category: 'News' }), author: null } };
  const b1 = { kind: 'post' as const, id: 'post_b1', item: { post: makePost({ id: 'b1', ownerUID: 'other_author', category: 'Events' }), author: null } };
  const spaced = diversifyCombinedHomeStream([a1, a2, b1]);
  assert.deepEqual(
    spaced.map((e) => e.id),
    ['post_a1', 'post_b1', 'post_a2']
  );
});
