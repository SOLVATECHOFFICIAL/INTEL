import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOptimisticFollowUpdate,
  canContactHaveFollowControl,
  extractActorUsernameFromNotification,
  partitionTrustedCircleDirectory,
  resolveFollowButtonPresentation,
  resolveFollowRelationshipState,
} from './followRelations';
import type { PublicProfileProjection, TrustedContact } from '../types/database';

test('resolveFollowRelationshipState returns all 5 deterministic states', () => {
  const following = new Set(['ada_lasued', 'tunde_rep']);
  const followers = new Set(['tunde_rep', 'zainab_dev']);

  assert.equal(
    resolveFollowRelationshipState({
      viewerUsername: 'me_user',
      targetUsername: 'ME_USER',
      followingUsernames: following,
      followerUsernames: followers,
    }),
    'self'
  );

  assert.equal(
    resolveFollowRelationshipState({
      viewerUsername: 'me_user',
      targetUsername: 'tunde_rep',
      followingUsernames: following,
      followerUsernames: followers,
    }),
    'friends'
  );

  assert.equal(
    resolveFollowRelationshipState({
      viewerUsername: 'me_user',
      targetUsername: 'ada_lasued',
      followingUsernames: following,
      followerUsernames: followers,
    }),
    'following'
  );

  assert.equal(
    resolveFollowRelationshipState({
      viewerUsername: 'me_user',
      targetUsername: 'zainab_dev',
      followingUsernames: following,
      followerUsernames: followers,
    }),
    'follow_back'
  );

  assert.equal(
    resolveFollowRelationshipState({
      viewerUsername: 'me_user',
      targetUsername: 'new_student',
      followingUsernames: following,
      followerUsernames: followers,
    }),
    'follow'
  );
});

test('resolveFollowButtonPresentation maps states to exact accessible labels', () => {
  assert.equal(resolveFollowButtonPresentation('follow', 'Ada').label, 'Follow');
  assert.equal(
    resolveFollowButtonPresentation('following', 'Ada').label,
    'Following'
  );
  assert.equal(
    resolveFollowButtonPresentation('follow_back', 'Ada').label,
    'Follow Back'
  );
  assert.equal(resolveFollowButtonPresentation('friends', 'Ada').label, 'Friends');
  assert.match(
    resolveFollowButtonPresentation('follow_back', 'Ada').ariaLabel,
    /@ada/
  );
});

test('applyOptimisticFollowUpdate blocks self-follow and negative counts', () => {
  const base = new Set(['alice']);
  const selfResult = applyOptimisticFollowUpdate({
    viewerUsername: 'alice',
    targetUsername: 'alice',
    nextFollowing: true,
    followingUsernames: base,
    currentFollowingCount: 1,
  });
  assert.equal(selfResult.changed, false);

  const unfollow = applyOptimisticFollowUpdate({
    viewerUsername: 'bob',
    targetUsername: 'alice',
    nextFollowing: false,
    followingUsernames: base,
    currentFollowingCount: 0,
  });
  assert.equal(unfollow.changed, true);
  assert.equal(unfollow.followingUsernames.has('alice'), false);
  assert.equal(unfollow.followingCount, 0);
});

test('extractActorUsernameFromNotification handles actorUsername, targetPath, and body', () => {
  assert.equal(
    extractActorUsernameFromNotification({
      actorUsername: 'Tunde_01',
    }),
    'tunde_01'
  );
  assert.equal(
    extractActorUsernameFromNotification({
      targetPath: '/?view=profile&username=Zainab_Lasued',
    }),
    'zainab_lasued'
  );
  assert.equal(
    extractActorUsernameFromNotification({
      body: '@chidi_csc is now following your campus profile.',
    }),
    'chidi_csc'
  );
  assert.equal(extractActorUsernameFromNotification({}), null);
});

test('partitionTrustedCircleDirectory isolates Supreme Admin, Verified, Recommended, and Official Contacts without account controls on contacts', () => {
  const supremeAdmin: PublicProfileProjection = {
    fullName: 'Director One',
    username: 'director_one',
    showWhatsappPublicly: false,
    badge: 'supreme_admin',
    accountStatus: 'active',
    followersCount: 12,
    followingCount: 3,
    createdAt: 1,
  };
  const verified: PublicProfileProjection = {
    fullName: 'Ada Campus',
    username: 'ada_campus',
    showWhatsappPublicly: false,
    badge: 'verified',
    accountStatus: 'active',
    followersCount: 8,
    followingCount: 2,
    createdAt: 1,
  };
  const verifiedModerator: PublicProfileProjection = {
    fullName: 'Mod Verified',
    username: 'mod_verified',
    showWhatsappPublicly: false,
    badge: 'moderator',
    isVerified: true,
    accountStatus: 'active',
    followersCount: 5,
    followingCount: 1,
    createdAt: 1,
  };
  const unverifiedModerator: PublicProfileProjection = {
    fullName: 'Mod Plain',
    username: 'mod_plain',
    showWhatsappPublicly: false,
    badge: 'moderator',
    isVerified: false,
    accountStatus: 'active',
    followersCount: 4,
    followingCount: 1,
    createdAt: 1,
  };
  const recommendedContact: TrustedContact = {
    id: 'c1',
    entryType: 'admin_listed_contact',
    isUserAccount: false,
    fullName: 'Dr. Bello',
    category: 'community_recommended',
    roleTitle: 'Student Mentor',
    contactNumber: '+2348012345678',
    createdByUid: 'admin1',
    createdAt: 1,
    updatedAt: 1,
  };
  const lecturerContact: TrustedContact = {
    id: 'c2',
    entryType: 'admin_listed_contact',
    isUserAccount: false,
    fullName: 'Prof. Okonkwo',
    category: 'lecturer',
    roleTitle: 'HOD Computer Science',
    contactNumber: '+2348098765432',
    createdByUid: 'admin1',
    createdAt: 1,
    updatedAt: 1,
  };

  const partitioned = partitionTrustedCircleDirectory({
    supremeAdmins: [supremeAdmin],
    verifiedMembers: [verified, verifiedModerator, unverifiedModerator],
    officialContacts: [recommendedContact, lecturerContact],
  });

  assert.equal(partitioned.supremeAdmins.length, 1);
  assert.equal(partitioned.officiallyVerifiedUsers.length, 2);
  assert.equal(partitioned.trustContacts.length, 2);
  assert.equal(partitioned.communityRecommendedContacts.length, 1);
  assert.equal(partitioned.officialCampusContacts.length, 1);
  assert.equal(canContactHaveFollowControl(recommendedContact), false);
  assert.equal(canContactHaveFollowControl(lecturerContact), false);
});
