import test, { after, before, beforeEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const PROJECT_ID = 'lasued-intel';

const UID = {
  supremePublic: 'uid_supreme_public',
  supremeUnderground: 'uid_supreme_underground',
  moderator: 'uid_mod_1',
  verified: 'uid_verified_1',
  badgeSpoof: 'uid_badge_spoof',
  member: 'uid_member_1',
  member2: 'uid_member_2',
};

const EMAIL = {
  supremePublic: 'lasuedintel@gmail.com',
  supremeUnderground: 'awoyinfasolomon1@gmail.com',
  moderator: 'mod1@lasued.edu.ng',
  verified: 'verified1@lasued.edu.ng',
  badgeSpoof: 'spoof@lasued.edu.ng',
  member: 'member1@lasued.edu.ng',
  member2: 'member2@lasued.edu.ng',
};

const VALID_BASE64 = 'A'.repeat(64);
const OVERSIZED_BASE64 = 'A'.repeat(340001);

let testEnv: RulesTestEnvironment;

function serverTs() {
  return firebase.firestore.FieldValue.serverTimestamp();
}

function delField() {
  return firebase.firestore.FieldValue.delete();
}

function tsFromMs(ms: number) {
  return firebase.firestore.Timestamp.fromMillis(ms);
}

function ctxFor(
  uid: string,
  email: string,
  emailVerified = true
): RulesTestContext {
  return testEnv.authenticatedContext(uid, {
    email,
    email_verified: emailVerified,
  });
}

async function seedAccounts() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const batch = db.batch();

    const users: Array<{
      uid: string;
      username: string;
      fullName: string;
      badge: 'none' | 'verified' | 'moderator' | 'supreme_admin';
      hidden: boolean;
      role?: 'supreme_admin' | 'moderator' | 'verified' | 'member';
      roleBadge?: 'none' | 'verified' | 'moderator' | 'supreme_admin';
    }> = [
      {
        uid: UID.supremePublic,
        username: 'lasued_public_admin',
        fullName: 'LASUED Public Admin',
        badge: 'supreme_admin',
        hidden: false,
        role: 'supreme_admin',
        roleBadge: 'supreme_admin',
      },
      {
        uid: UID.supremeUnderground,
        username: 'underground_desk_1',
        fullName: 'LASUED Official Desk',
        badge: 'none',
        hidden: true,
        role: 'supreme_admin',
        roleBadge: 'supreme_admin',
      },
      {
        uid: UID.moderator,
        username: 'campus_moderator_1',
        fullName: 'Campus Moderator',
        badge: 'moderator',
        hidden: false,
        role: 'moderator',
        roleBadge: 'moderator',
      },
      {
        uid: UID.verified,
        username: 'verified_student_1',
        fullName: 'Verified Student',
        badge: 'verified',
        hidden: false,
        role: 'verified',
        roleBadge: 'verified',
      },
      {
        uid: UID.badgeSpoof,
        username: 'badge_spoof_user',
        fullName: 'Badge Spoof User',
        badge: 'verified',
        hidden: false,
      },
      {
        uid: UID.member,
        username: 'standard_member_1',
        fullName: 'Standard Member One',
        badge: 'none',
        hidden: false,
      },
      {
        uid: UID.member2,
        username: 'standard_member_2',
        fullName: 'Standard Member Two',
        badge: 'none',
        hidden: false,
        role: 'member',
        roleBadge: 'none',
      },
    ];

    for (const u of users) {
      batch.set(db.doc(`users/${u.uid}`), {
        uid: u.uid,
        memberId: `MEM_${u.uid}`,
        fullName: u.fullName,
        username: u.username,
        badge: u.badge,
        accountStatus: 'active',
        isHiddenFromDirectory: u.hidden,
        showWhatsappPublicly: false,
        followersCount: 0,
        followingCount: 0,
        createdAt: serverTs(),
        updatedAt: serverTs(),
      });
      if (u.role && u.roleBadge) {
        batch.set(db.doc(`userRoles/${u.uid}`), {
          uid: u.uid,
          role: u.role,
          badge: u.roleBadge,
          isPermanentOwner: false,
          isHiddenFromDirectory: u.hidden,
          updatedAt: serverTs(),
        });
      }
    }

    await batch.commit();
  });
}

async function seedOfficialUpdateAndPoll(options?: {
  updateId?: string;
  pollId?: string;
  authorMode?: 'public_admin' | 'official_desk';
  allowMultiple?: boolean;
  maxSelections?: number;
  allowVoteChange?: boolean;
  voterScope?: 'all_members' | 'verified_and_above';
  status?: 'open' | 'closed';
  expiresAtMs?: number;
  optionCount?: number;
}) {
  const updateId = options?.updateId ?? 'upd_seeded_1';
  const pollId = options?.pollId ?? 'poll_seeded_1';
  const authorMode = options?.authorMode ?? 'public_admin';
  const optionCount = options?.optionCount ?? 3;
  const pollOptions = Array.from({ length: optionCount }, (_, i) => `Option ${i + 1}`);
  const zeroCounts = Array.from({ length: optionCount }, () => 0);

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const batch = db.batch();
    const updateDoc: Record<string, unknown> = {
      id: updateId,
      format: 'text',
      authorMode,
      authorDisplayName:
        authorMode === 'official_desk' ? 'LASUED Intel Official' : 'LASUED Public Admin',
      authorBadge: authorMode === 'official_desk' ? 'verified' : 'supreme_admin',
      category: 'announcement',
      title: 'Official Campus Decision',
      body: 'Please cast your ballot on this official announcement.',
      backgroundStyle: 'navy_slate',
      pollId,
      isPinned: false,
      status: 'published',
      visibility: 'public',
      likesCount: 0,
      commentsCount: 0,
      createdAt: serverTs(),
      updatedAt: serverTs(),
    };
    if (authorMode === 'public_admin') {
      updateDoc.ownerUID = UID.supremePublic;
    }

    const pollDoc: Record<string, unknown> = {
      id: pollId,
      updateId,
      authorMode,
      question: 'Which schedule works best for faculty orientation?',
      description: 'Official senate guidance poll.',
      options: pollOptions,
      optionCounts: zeroCounts,
      totalVotes: 0,
      allowMultiple: options?.allowMultiple ?? false,
      maxSelections: options?.maxSelections ?? 1,
      allowVoteChange: options?.allowVoteChange ?? true,
      voterScope: options?.voterScope ?? 'all_members',
      resultsVisibility: 'always',
      status: options?.status ?? 'open',
      expiresAt: tsFromMs(options?.expiresAtMs ?? Date.now() + 3_600_000),
      createdAt: serverTs(),
      updatedAt: serverTs(),
    };
    if (authorMode === 'public_admin') {
      pollDoc.ownerUID = UID.supremePublic;
    }

    batch.set(db.doc(`updates/${updateId}`), updateDoc);
    batch.set(db.doc(`polls/${pollId}`), pollDoc);
    await batch.commit();
  });

  return { updateId, pollId };
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(path.resolve('firestore.rules'), 'utf8'),
    },
  });
});

after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedAccounts();
});

test('Supreme Admin permissions: email verification lock, official updates (public & official_desk), cross-admin editing, and polls', async () => {
  const unverifiedSupremeDb = ctxFor(
    UID.supremePublic,
    EMAIL.supremePublic,
    false
  ).firestore();
  const publicSupremeDb = ctxFor(
    UID.supremePublic,
    EMAIL.supremePublic,
    true
  ).firestore();
  const undergroundSupremeDb = ctxFor(
    UID.supremeUnderground,
    EMAIL.supremeUnderground,
    true
  ).firestore();

  // Unverified email token must fail even if email matches Supreme Admin
  await assertFails(
    unverifiedSupremeDb.doc('updates/upd_unverified').set({
      id: 'upd_unverified',
      format: 'text',
      authorMode: 'public_admin',
      ownerUID: UID.supremePublic,
      authorDisplayName: 'LASUED Public Admin',
      authorBadge: 'supreme_admin',
      category: 'announcement',
      body: 'Should be blocked when email_verified is false.',
      backgroundStyle: 'navy_slate',
      isPinned: false,
      status: 'published',
      visibility: 'public',
      likesCount: 0,
      commentsCount: 0,
      createdAt: serverTs(),
      updatedAt: serverTs(),
    })
  );

  // Public Supreme Admin publishes text Official Update + Poll + Mapping + Audit Log in one batch
  const b1 = publicSupremeDb.batch();
  b1.set(publicSupremeDb.doc('polls/poll_pub_1'), {
    id: 'poll_pub_1',
    updateId: 'upd_pub_1',
    authorMode: 'public_admin',
    ownerUID: UID.supremePublic,
    question: 'Approve updated library hours?',
    description: 'Applies to all main campus reading halls.',
    options: ['Yes, extend until 10 PM', 'Keep 8 PM closing'],
    optionCounts: [0, 0],
    totalVotes: 0,
    allowMultiple: false,
    maxSelections: 1,
    allowVoteChange: true,
    voterScope: 'all_members',
    resultsVisibility: 'always',
    status: 'open',
    expiresAt: tsFromMs(Date.now() + 7_200_000),
    createdAt: serverTs(),
    updatedAt: serverTs(),
  });
  b1.set(publicSupremeDb.doc('updates/upd_pub_1'), {
    id: 'upd_pub_1',
    format: 'text',
    authorMode: 'public_admin',
    ownerUID: UID.supremePublic,
    authorDisplayName: 'LASUED Public Admin',
    authorBadge: 'supreme_admin',
    category: 'academic',
    title: 'Library Reading Hall Hours',
    body: 'Vote on extending evening reading hours ahead of exams.',
    backgroundStyle: 'ocean_blue',
    pollId: 'poll_pub_1',
    isPinned: true,
    status: 'published',
    visibility: 'public',
    likesCount: 0,
    commentsCount: 0,
    createdAt: serverTs(),
    updatedAt: serverTs(),
  });
  b1.set(publicSupremeDb.doc('adminUpdateMappings/upd_pub_1'), {
    updateId: 'upd_pub_1',
    authorUid: UID.supremePublic,
    authorMode: 'public_admin',
    createdAt: serverTs(),
  });
  b1.set(publicSupremeDb.doc('adminAuditLogs/log_upd_pub_1'), {
    id: 'log_upd_pub_1',
    action: 'update_created',
    targetCollection: 'updates',
    targetId: 'upd_pub_1',
    performedByUid: UID.supremePublic,
    performedByRole: 'supreme_admin',
    createdAt: serverTs(),
  });
  await assertSucceeds(b1.commit());

  // Underground Supreme Admin publishes photo Official Update (official_desk, NO ownerUID anywhere)
  const b2 = undergroundSupremeDb.batch();
  b2.set(undergroundSupremeDb.doc('updates/upd_desk_1'), {
    id: 'upd_desk_1',
    format: 'photo',
    authorMode: 'official_desk',
    authorDisplayName: 'LASUED Intel Official',
    authorBadge: 'verified',
    category: 'urgent',
    title: 'Security Notice',
    body: 'Verified campus gate schedule attached.',
    mediaItems: [
      {
        imageId: 'img_desk_1',
        width: 1080,
        height: 1080,
        byteSize: 12000,
        mimeType: 'image/webp',
        order: 0,
      },
    ],
    isPinned: false,
    status: 'published',
    visibility: 'public',
    likesCount: 0,
    commentsCount: 0,
    createdAt: serverTs(),
    updatedAt: serverTs(),
  });
  b2.set(undergroundSupremeDb.doc('adminUpdateMappings/upd_desk_1'), {
    updateId: 'upd_desk_1',
    authorUid: UID.supremeUnderground,
    authorMode: 'official_desk',
    createdAt: serverTs(),
  });
  b2.set(undergroundSupremeDb.doc('mediaImages/img_desk_1'), {
    id: 'img_desk_1',
    targetCollection: 'updates',
    targetId: 'upd_desk_1',
    mimeType: 'image/webp',
    width: 1080,
    height: 1080,
    byteSize: 12000,
    base64Data: VALID_BASE64,
    createdAt: serverTs(),
  });
  await assertSucceeds(b2.commit());

  // Underground Supreme Admin cannot impersonate public_admin mode
  await assertFails(
    undergroundSupremeDb.doc('updates/upd_bad_mode').set({
      id: 'upd_bad_mode',
      format: 'text',
      authorMode: 'public_admin',
      ownerUID: UID.supremeUnderground,
      authorDisplayName: 'Spoof',
      authorBadge: 'supreme_admin',
      category: 'announcement',
      body: 'Should fail.',
      backgroundStyle: 'navy_slate',
      isPinned: false,
      status: 'published',
      visibility: 'public',
      likesCount: 0,
      commentsCount: 0,
      createdAt: serverTs(),
      updatedAt: serverTs(),
    })
  );

  // Cross-admin collaboration: Underground Supreme Admin closes & edits Public Supreme Admin's poll and update
  await assertSucceeds(
    undergroundSupremeDb.doc('polls/poll_pub_1').update({
      status: 'closed',
      description: delField(),
      updatedAt: serverTs(),
    })
  );
  await assertSucceeds(
    undergroundSupremeDb.doc('updates/upd_pub_1').update({
      isPinned: false,
      body: 'Updated guidance from LASUED Admin Desk.',
      updatedAt: serverTs(),
    })
  );

  // Poll cannot be created standalone without a matching published update referencing pollId
  await assertFails(
    publicSupremeDb.doc('polls/poll_orphan_1').set({
      id: 'poll_orphan_1',
      updateId: 'non_existent_update',
      authorMode: 'public_admin',
      ownerUID: UID.supremePublic,
      question: 'Orphan poll attempt?',
      options: ['A', 'B'],
      optionCounts: [0, 0],
      totalVotes: 0,
      allowMultiple: false,
      maxSelections: 1,
      allowVoteChange: false,
      voterScope: 'all_members',
      resultsVisibility: 'always',
      status: 'open',
      expiresAt: tsFromMs(Date.now() + 3_600_000),
      createdAt: serverTs(),
      updatedAt: serverTs(),
    })
  );

  // Poll description over 300 chars must fail
  const badPollBatch = publicSupremeDb.batch();
  badPollBatch.set(publicSupremeDb.doc('polls/poll_desc_too_long'), {
    id: 'poll_desc_too_long',
    updateId: 'upd_desc_too_long',
    authorMode: 'public_admin',
    ownerUID: UID.supremePublic,
    question: 'Test long description rejection?',
    description: 'x'.repeat(301),
    options: ['Yes', 'No'],
    optionCounts: [0, 0],
    totalVotes: 0,
    allowMultiple: false,
    maxSelections: 1,
    allowVoteChange: false,
    voterScope: 'all_members',
    resultsVisibility: 'always',
    status: 'open',
    expiresAt: tsFromMs(Date.now() + 3_600_000),
    createdAt: serverTs(),
    updatedAt: serverTs(),
  });
  badPollBatch.set(publicSupremeDb.doc('updates/upd_desc_too_long'), {
    id: 'upd_desc_too_long',
    format: 'text',
    authorMode: 'public_admin',
    ownerUID: UID.supremePublic,
    authorDisplayName: 'LASUED Public Admin',
    authorBadge: 'supreme_admin',
    category: 'announcement',
    body: 'Update body',
    backgroundStyle: 'navy_slate',
    pollId: 'poll_desc_too_long',
    isPinned: false,
    status: 'published',
    visibility: 'public',
    likesCount: 0,
    commentsCount: 0,
    createdAt: serverTs(),
    updatedAt: serverTs(),
  });
  await assertFails(badPollBatch.commit());
});

test('Role governance: Supreme Admin promotes Verified/Moderator safely; self-promotion, badge-only spoofing, and permanentOwner escalation fail', async () => {
  const publicSupremeDb = ctxFor(UID.supremePublic, EMAIL.supremePublic).firestore();
  const verifiedDb = ctxFor(UID.verified, EMAIL.verified).firestore();
  const memberDb = ctxFor(UID.member, EMAIL.member).firestore();
  const badgeSpoofDb = ctxFor(UID.badgeSpoof, EMAIL.badgeSpoof).firestore();

  // Supreme Admin promotes member1 to verified with role-badge sync + audit log
  const promoteBatch = publicSupremeDb.batch();
  promoteBatch.set(publicSupremeDb.doc(`userRoles/${UID.member}`), {
    uid: UID.member,
    role: 'verified',
    badge: 'verified',
    isVerified: true,
    isPermanentOwner: false,
    isHiddenFromDirectory: false,
    grantedBy: UID.supremePublic,
    updatedAt: serverTs(),
  });
  promoteBatch.update(publicSupremeDb.doc(`users/${UID.member}`), {
    badge: 'verified',
    isVerified: true,
    updatedAt: serverTs(),
  });
  promoteBatch.set(publicSupremeDb.doc('badgeAuditLogs/badge_log_1'), {
    id: 'badge_log_1',
    targetUid: UID.member,
    action: 'grant_verified',
    previousRole: 'member',
    previousBadge: 'none',
    nextRole: 'verified',
    nextBadge: 'verified',
    performedByUid: UID.supremePublic,
    performedByRole: 'supreme_admin',
    createdAt: serverTs(),
  });
  await assertSucceeds(promoteBatch.commit());

  // Supreme Admin cannot grant supreme_admin role to another account
  await assertFails(
    publicSupremeDb.doc(`userRoles/${UID.verified}`).set({
      uid: UID.verified,
      role: 'supreme_admin',
      badge: 'supreme_admin',
      isPermanentOwner: false,
      isHiddenFromDirectory: false,
      grantedBy: UID.supremePublic,
      updatedAt: serverTs(),
    })
  );

  // Supreme Admin cannot set isPermanentOwner: true
  await assertFails(
    publicSupremeDb.doc(`userRoles/${UID.supremePublic}`).update({
      isPermanentOwner: true,
      updatedAt: serverTs(),
    })
  );

  // Verified user & member cannot self-promote or edit badges
  await assertFails(
    verifiedDb.doc(`userRoles/${UID.verified}`).update({
      role: 'moderator',
      badge: 'moderator',
      updatedAt: serverTs(),
    })
  );
  await assertFails(
    memberDb.doc(`users/${UID.member2}`).update({
      badge: 'moderator',
      updatedAt: serverTs(),
    })
  );

  // Badge-only spoof (users.badge == 'verified' WITHOUT userRoles.role == 'verified') CANNOT publish /posts
  await assertFails(
    badgeSpoofDb.doc('posts/post_spoof_1').set({
      id: 'post_spoof_1',
      ownerUID: UID.badgeSpoof,
      authorRole: 'verified',
      postType: 'text',
      category: 'campus',
      body: 'Spoof attempt using badge field alone.',
      backgroundStyle: 'navy_slate',
      isOfficial: false,
      isPinned: false,
      status: 'published',
      visibility: 'public',
      likesCount: 0,
      commentsCount: 0,
      createdAt: serverTs(),
      updatedAt: serverTs(),
    })
  );
});

test('Publishing matrix: Verified Member & Moderator ordinary posts + photo uploads; Standard Member restrictions & anonymous isolation', async () => {
  const verifiedDb = ctxFor(UID.verified, EMAIL.verified).firestore();
  const modDb = ctxFor(UID.moderator, EMAIL.moderator).firestore();
  const memberDb = ctxFor(UID.member, EMAIL.member).firestore();
  const member2Db = ctxFor(UID.member2, EMAIL.member2).firestore();

  // Verified Member publishes a photo post + mediaImages in a single batch
  const vBatch = verifiedDb.batch();
  vBatch.set(verifiedDb.doc('posts/post_ver_photo_1'), {
    id: 'post_ver_photo_1',
    ownerUID: UID.verified,
    authorRole: 'verified',
    postType: 'photo',
    category: 'campus',
    body: 'Fresh campus photo update.',
    mediaItems: [
      {
        imageId: 'img_ver_1',
        width: 1200,
        height: 900,
        byteSize: 45000,
        mimeType: 'image/jpeg',
        order: 0,
      },
    ],
    isOfficial: false,
    isPinned: false,
    status: 'published',
    visibility: 'public',
    likesCount: 0,
    commentsCount: 0,
    createdAt: serverTs(),
    updatedAt: serverTs(),
  });
  vBatch.set(verifiedDb.doc('mediaImages/img_ver_1'), {
    id: 'img_ver_1',
    targetCollection: 'posts',
    targetId: 'post_ver_photo_1',
    ownerUID: UID.verified,
    mimeType: 'image/jpeg',
    width: 1200,
    height: 900,
    byteSize: 45000,
    base64Data: VALID_BASE64,
    createdAt: serverTs(),
  });
  await assertSucceeds(vBatch.commit());

  // Verified Member CANNOT publish an official post (isOfficial: true) or Official Update or Poll
  await assertFails(
    verifiedDb.doc('posts/post_ver_fake_official').set({
      id: 'post_ver_fake_official',
      ownerUID: UID.verified,
      authorRole: 'verified',
      postType: 'text',
      category: 'campus',
      body: 'Trying to set isOfficial true.',
      backgroundStyle: 'navy_slate',
      isOfficial: true,
      isPinned: false,
      status: 'published',
      visibility: 'public',
      likesCount: 0,
      commentsCount: 0,
      createdAt: serverTs(),
      updatedAt: serverTs(),
    })
  );
  await assertFails(
    verifiedDb.doc('updates/upd_ver_blocked').set({
      id: 'upd_ver_blocked',
      format: 'text',
      authorMode: 'public_admin',
      ownerUID: UID.verified,
      authorDisplayName: 'Verified Student',
      authorBadge: 'verified',
      category: 'announcement',
      body: 'Not allowed.',
      backgroundStyle: 'navy_slate',
      isPinned: false,
      status: 'published',
      visibility: 'public',
      likesCount: 0,
      commentsCount: 0,
      createdAt: serverTs(),
      updatedAt: serverTs(),
    })
  );

  // Oversized base64Data (> 340,000) or invalid mimeType must fail
  await assertFails(
    verifiedDb.doc('mediaImages/img_oversized').set({
      id: 'img_oversized',
      targetCollection: 'users_avatar',
      targetId: UID.verified,
      ownerUID: UID.verified,
      mimeType: 'image/webp',
      width: 512,
      height: 512,
      byteSize: 200000,
      base64Data: OVERSIZED_BASE64,
      createdAt: serverTs(),
    })
  );

  // Moderator publishes ordinary text post, CANNOT publish Official Updates, CANNOT read anonymousIdentityMappings
  await assertSucceeds(
    modDb.doc('posts/post_mod_1').set({
      id: 'post_mod_1',
      ownerUID: UID.moderator,
      authorRole: 'moderator',
      postType: 'text',
      category: 'campus',
      body: 'Moderator campus reminder.',
      backgroundStyle: 'cobalt_indigo',
      isOfficial: false,
      isPinned: false,
      status: 'published',
      visibility: 'public',
      likesCount: 0,
      commentsCount: 0,
      createdAt: serverTs(),
      updatedAt: serverTs(),
    })
  );
  await assertFails(
    modDb.doc('updates/upd_mod_blocked').set({
      id: 'upd_mod_blocked',
      format: 'text',
      authorMode: 'public_admin',
      ownerUID: UID.moderator,
      authorDisplayName: 'Campus Moderator',
      authorBadge: 'supreme_admin',
      category: 'announcement',
      body: 'Moderators cannot publish official updates.',
      backgroundStyle: 'navy_slate',
      isPinned: false,
      status: 'published',
      visibility: 'public',
      likesCount: 0,
      commentsCount: 0,
      createdAt: serverTs(),
      updatedAt: serverTs(),
    })
  );

  // Moderator CANNOT delete a Verified Member's ordinary post
  await assertFails(modDb.doc('posts/post_ver_photo_1').delete());

  // Standard Member CANNOT publish ordinary /posts
  await assertFails(
    memberDb.doc('posts/post_member_blocked').set({
      id: 'post_member_blocked',
      ownerUID: UID.member,
      authorRole: 'verified',
      postType: 'text',
      category: 'campus',
      body: 'Standard member trying to post in ordinary feed.',
      backgroundStyle: 'navy_slate',
      isOfficial: false,
      isPinned: false,
      status: 'published',
      visibility: 'public',
      likesCount: 0,
      commentsCount: 0,
      createdAt: serverTs(),
      updatedAt: serverTs(),
    })
  );

  // Standard Member CAN publish an Anonymous Unfiltered post + mapping + private history
  const anonBatch = memberDb.batch();
  anonBatch.set(memberDb.doc('anonymousPosts/anon_1'), {
    id: 'anon_1',
    postType: 'text',
    category: 'confessions',
    body: 'Anonymous campus thought.',
    status: 'published',
    visibility: 'public',
    likesCount: 0,
    commentsCount: 0,
    createdAt: serverTs(),
    updatedAt: serverTs(),
  });
  anonBatch.set(memberDb.doc('anonymousIdentityMappings/anon_1'), {
    entryId: 'anon_1',
    entryType: 'anonymousPosts',
    authorUid: UID.member,
    authorRole: 'member',
    createdAt: serverTs(),
  });
  anonBatch.set(
    memberDb.doc(`privateUserData/${UID.member}/anonymousHistory/anon_1`),
    {
      postId: 'anon_1',
      createdAt: serverTs(),
    }
  );
  await assertSucceeds(anonBatch.commit());

  // Neither Moderator nor another member can read anonymousIdentityMappings; only Supreme Admin can
  await assertFails(modDb.doc('anonymousIdentityMappings/anon_1').get());
  await assertFails(member2Db.doc('anonymousIdentityMappings/anon_1').get());
  await assertSucceeds(
    ctxFor(UID.supremePublic, EMAIL.supremePublic)
      .firestore()
      .doc('anonymousIdentityMappings/anon_1')
      .get()
  );

  // Moderator CAN delete an ordinary member's anonymous post & write allowed adminAuditLogs
  const modDelBatch = modDb.batch();
  modDelBatch.delete(modDb.doc('anonymousPosts/anon_1'));
  modDelBatch.delete(modDb.doc('anonymousIdentityMappings/anon_1'));
  modDelBatch.set(modDb.doc('adminAuditLogs/mod_del_log_1'), {
    id: 'mod_del_log_1',
    action: 'anonymous_post_deleted',
    targetCollection: 'anonymousPosts',
    targetId: 'anon_1',
    performedByUid: UID.moderator,
    performedByRole: 'moderator',
    createdAt: serverTs(),
  });
  await assertSucceeds(modDelBatch.commit());

  // Standard Member CAN comment on Verified Member's post & like it atomically
  const commentBatch = memberDb.batch();
  commentBatch.set(memberDb.doc('postComments/cmt_1'), {
    id: 'cmt_1',
    postId: 'post_ver_photo_1',
    targetCollection: 'posts',
    ownerUID: UID.member,
    body: 'Great campus update!',
    status: 'published',
    likesCount: 0,
    createdAt: serverTs(),
    updatedAt: serverTs(),
  });
  commentBatch.update(memberDb.doc('posts/post_ver_photo_1'), {
    commentsCount: 1,
  });
  await assertSucceeds(commentBatch.commit());

  const likeBatch = member2Db.batch();
  likeBatch.set(
    member2Db.doc(`postReactions/posts_post_ver_photo_1_${UID.member2}`),
    {
      targetCollection: 'posts',
      targetId: 'post_ver_photo_1',
      ownerUID: UID.member2,
      reactionType: 'like',
      createdAt: serverTs(),
    }
  );
  likeBatch.update(member2Db.doc('posts/post_ver_photo_1'), {
    likesCount: 1,
  });
  await assertSucceeds(likeBatch.commit());
});

test('Official Polls voting rules: single-choice, multi-choice maxSelections, vote changes, reactions/comments, expiry, close, and voterScope', async () => {
  const memberDb = ctxFor(UID.member, EMAIL.member).firestore();
  const member2Db = ctxFor(UID.member2, EMAIL.member2).firestore();
  const verifiedDb = ctxFor(UID.verified, EMAIL.verified).firestore();
  const modDb = ctxFor(UID.moderator, EMAIL.moderator).firestore();
  const badgeSpoofDb = ctxFor(UID.badgeSpoof, EMAIL.badgeSpoof).firestore();

  // 1) Multi-choice poll (3 options, maxSelections: 2, allowVoteChange: true)
  const { updateId: uMulti, pollId: pMulti } = await seedOfficialUpdateAndPoll({
    updateId: 'upd_multi',
    pollId: 'poll_multi',
    authorMode: 'official_desk',
    allowMultiple: true,
    maxSelections: 2,
    allowVoteChange: true,
    voterScope: 'all_members',
    optionCount: 3,
  });

  // Member selects 2 options ([0, 2]) via transaction -> succeeds
  await assertSucceeds(
    memberDb.runTransaction(async (tx) => {
      const pollRef = memberDb.doc(`polls/${pMulti}`);
      const voteRef = memberDb.doc(`polls/${pMulti}/votes/${UID.member}`);
      await tx.get(pollRef);
      await tx.get(voteRef);
      tx.set(voteRef, {
        id: UID.member,
        pollId: pMulti,
        voterUid: UID.member,
        selectedIndices: [0, 2],
        createdAt: serverTs(),
        updatedAt: serverTs(),
      });
      tx.update(pollRef, {
        optionCounts: [1, 0, 1],
        totalVotes: 1,
        updatedAt: serverTs(),
      });
    })
  );

  // Member2 tries selecting 3 options ([0, 1, 2]) when maxSelections == 2 -> fails
  await assertFails(
    member2Db.runTransaction(async (tx) => {
      const pollRef = member2Db.doc(`polls/${pMulti}`);
      const voteRef = member2Db.doc(`polls/${pMulti}/votes/${UID.member2}`);
      await tx.get(pollRef);
      tx.set(voteRef, {
        id: UID.member2,
        pollId: pMulti,
        voterUid: UID.member2,
        selectedIndices: [0, 1, 2],
        createdAt: serverTs(),
        updatedAt: serverTs(),
      });
      tx.update(pollRef, {
        optionCounts: [2, 1, 2],
        totalVotes: 2,
        updatedAt: serverTs(),
      });
    })
  );

  // Member changes vote from [0, 2] to [1] -> totalVotes remains 1, counts become [0, 1, 0]
  await assertSucceeds(
    memberDb.runTransaction(async (tx) => {
      const pollRef = memberDb.doc(`polls/${pMulti}`);
      const voteRef = memberDb.doc(`polls/${pMulti}/votes/${UID.member}`);
      await tx.get(pollRef);
      await tx.get(voteRef);
      tx.update(voteRef, {
        selectedIndices: [1],
        updatedAt: serverTs(),
      });
      tx.update(pollRef, {
        optionCounts: [0, 1, 0],
        totalVotes: 1,
        updatedAt: serverTs(),
      });
    })
  );

  // Member cannot tamper with totalVotes when changing vote
  await assertFails(
    memberDb.runTransaction(async (tx) => {
      const pollRef = memberDb.doc(`polls/${pMulti}`);
      const voteRef = memberDb.doc(`polls/${pMulti}/votes/${UID.member}`);
      await tx.get(pollRef);
      await tx.get(voteRef);
      tx.update(voteRef, {
        selectedIndices: [0],
        updatedAt: serverTs(),
      });
      tx.update(pollRef, {
        optionCounts: [1, 0, 0],
        totalVotes: 99,
        updatedAt: serverTs(),
      });
    })
  );

  // Reactions & comments underneath an official update with a poll succeed
  const reactBatch = memberDb.batch();
  reactBatch.set(
    memberDb.doc(`postReactions/updates_${uMulti}_${UID.member}`),
    {
      targetCollection: 'updates',
      targetId: uMulti,
      ownerUID: UID.member,
      reactionType: 'like',
      createdAt: serverTs(),
    }
  );
  reactBatch.update(memberDb.doc(`updates/${uMulti}`), { likesCount: 1 });
  await assertSucceeds(reactBatch.commit());

  const cmtBatch = memberDb.batch();
  cmtBatch.set(memberDb.doc('postComments/cmt_update_poll_1'), {
    id: 'cmt_update_poll_1',
    postId: uMulti,
    targetCollection: 'updates',
    ownerUID: UID.member,
    body: 'I voted for option 2!',
    status: 'published',
    likesCount: 0,
    createdAt: serverTs(),
    updatedAt: serverTs(),
  });
  cmtBatch.update(memberDb.doc(`updates/${uMulti}`), { commentsCount: 1 });
  await assertSucceeds(cmtBatch.commit());

  // 2) Verified-and-above poll: Standard Member & Badge-Spoof fail; Verified & Moderator succeed
  const { pollId: pVerifiedOnly } = await seedOfficialUpdateAndPoll({
    updateId: 'upd_ver_scope',
    pollId: 'poll_ver_scope',
    allowMultiple: false,
    maxSelections: 1,
    allowVoteChange: false,
    voterScope: 'verified_and_above',
    optionCount: 2,
  });

  await assertFails(
    memberDb.runTransaction(async (tx) => {
      const pollRef = memberDb.doc(`polls/${pVerifiedOnly}`);
      const voteRef = memberDb.doc(`polls/${pVerifiedOnly}/votes/${UID.member}`);
      tx.set(voteRef, {
        id: UID.member,
        pollId: pVerifiedOnly,
        voterUid: UID.member,
        selectedIndices: [0],
        createdAt: serverTs(),
        updatedAt: serverTs(),
      });
      tx.update(pollRef, {
        optionCounts: [1, 0],
        totalVotes: 1,
        updatedAt: serverTs(),
      });
    })
  );

  await assertFails(
    badgeSpoofDb.runTransaction(async (tx) => {
      const pollRef = badgeSpoofDb.doc(`polls/${pVerifiedOnly}`);
      const voteRef = badgeSpoofDb.doc(
        `polls/${pVerifiedOnly}/votes/${UID.badgeSpoof}`
      );
      tx.set(voteRef, {
        id: UID.badgeSpoof,
        pollId: pVerifiedOnly,
        voterUid: UID.badgeSpoof,
        selectedIndices: [0],
        createdAt: serverTs(),
        updatedAt: serverTs(),
      });
      tx.update(pollRef, {
        optionCounts: [1, 0],
        totalVotes: 1,
        updatedAt: serverTs(),
      });
    })
  );

  await assertSucceeds(
    verifiedDb.runTransaction(async (tx) => {
      const pollRef = verifiedDb.doc(`polls/${pVerifiedOnly}`);
      const voteRef = verifiedDb.doc(`polls/${pVerifiedOnly}/votes/${UID.verified}`);
      await tx.get(pollRef);
      tx.set(voteRef, {
        id: UID.verified,
        pollId: pVerifiedOnly,
        voterUid: UID.verified,
        selectedIndices: [0],
        createdAt: serverTs(),
        updatedAt: serverTs(),
      });
      tx.update(pollRef, {
        optionCounts: [1, 0],
        totalVotes: 1,
        updatedAt: serverTs(),
      });
    })
  );

  // Vote change rejected when allowVoteChange == false
  await assertFails(
    verifiedDb.runTransaction(async (tx) => {
      const pollRef = verifiedDb.doc(`polls/${pVerifiedOnly}`);
      const voteRef = verifiedDb.doc(`polls/${pVerifiedOnly}/votes/${UID.verified}`);
      await tx.get(pollRef);
      await tx.get(voteRef);
      tx.update(voteRef, {
        selectedIndices: [1],
        updatedAt: serverTs(),
      });
      tx.update(pollRef, {
        optionCounts: [0, 1],
        totalVotes: 1,
        updatedAt: serverTs(),
      });
    })
  );

  await assertSucceeds(
    modDb.runTransaction(async (tx) => {
      const pollRef = modDb.doc(`polls/${pVerifiedOnly}`);
      const voteRef = modDb.doc(`polls/${pVerifiedOnly}/votes/${UID.moderator}`);
      await tx.get(pollRef);
      tx.set(voteRef, {
        id: UID.moderator,
        pollId: pVerifiedOnly,
        voterUid: UID.moderator,
        selectedIndices: [1],
        createdAt: serverTs(),
        updatedAt: serverTs(),
      });
      tx.update(pollRef, {
        optionCounts: [1, 1],
        totalVotes: 2,
        updatedAt: serverTs(),
      });
    })
  );

  // 3) Expired & Closed polls stop voting automatically while keeping results readable
  const { pollId: pExpired } = await seedOfficialUpdateAndPoll({
    updateId: 'upd_expired',
    pollId: 'poll_expired',
    expiresAtMs: Date.now() - 60_000,
    optionCount: 2,
  });
  await assertSucceeds(memberDb.doc(`polls/${pExpired}`).get());
  await assertFails(
    memberDb.runTransaction(async (tx) => {
      const pollRef = memberDb.doc(`polls/${pExpired}`);
      const voteRef = memberDb.doc(`polls/${pExpired}/votes/${UID.member}`);
      tx.set(voteRef, {
        id: UID.member,
        pollId: pExpired,
        voterUid: UID.member,
        selectedIndices: [0],
        createdAt: serverTs(),
        updatedAt: serverTs(),
      });
      tx.update(pollRef, {
        optionCounts: [1, 0],
        totalVotes: 1,
        updatedAt: serverTs(),
      });
    })
  );

  const { pollId: pClosed } = await seedOfficialUpdateAndPoll({
    updateId: 'upd_closed',
    pollId: 'poll_closed',
    status: 'closed',
    optionCount: 2,
  });
  await assertSucceeds(memberDb.doc(`polls/${pClosed}`).get());
  await assertFails(
    memberDb.runTransaction(async (tx) => {
      const pollRef = memberDb.doc(`polls/${pClosed}`);
      const voteRef = memberDb.doc(`polls/${pClosed}/votes/${UID.member}`);
      tx.set(voteRef, {
        id: UID.member,
        pollId: pClosed,
        voterUid: UID.member,
        selectedIndices: [0],
        createdAt: serverTs(),
        updatedAt: serverTs(),
      });
      tx.update(pollRef, {
        optionCounts: [1, 0],
        totalVotes: 1,
        updatedAt: serverTs(),
      });
    })
  );
});

test('Marketplace rules: Standard Member pending_approval lock, Moderator approval of ordinary members, and Verified direct publish', async () => {
  const memberDb = ctxFor(UID.member, EMAIL.member).firestore();
  const verifiedDb = ctxFor(UID.verified, EMAIL.verified).firestore();
  const modDb = ctxFor(UID.moderator, EMAIL.moderator).firestore();

  // Standard Member cannot self-approve a marketplace listing
  await assertFails(
    memberDb.doc('marketplaceListings/mkt_self_approve').set({
      id: 'mkt_self_approve',
      ownerUID: UID.member,
      listingKind: 'product',
      title: 'Scientific Calculator',
      description: 'Clean scientific calculator for engineering exams.',
      category: 'electronics',
      price: 12000,
      quantity: 1,
      whatsappNumber: '+2348012345678',
      approvalStatus: 'approved',
      status: 'active',
      visibility: 'public',
      createdAt: serverTs(),
      updatedAt: serverTs(),
      expiresAt: tsFromMs(Date.now() + 7 * 86_400_000),
    })
  );

  // Standard Member creates pending_approval listing
  await assertSucceeds(
    memberDb.doc('marketplaceListings/mkt_pending_1').set({
      id: 'mkt_pending_1',
      ownerUID: UID.member,
      listingKind: 'product',
      title: 'Scientific Calculator',
      description: 'Clean scientific calculator for engineering exams.',
      category: 'electronics',
      price: 12000,
      quantity: 1,
      whatsappNumber: '+2348012345678',
      approvalStatus: 'pending_approval',
      status: 'pending_approval',
      visibility: 'owner_and_admins',
      createdAt: serverTs(),
      updatedAt: serverTs(),
      expiresAt: tsFromMs(Date.now() + 7 * 86_400_000),
    })
  );

  // Moderator approves ordinary member's pending listing + logs audit entry + notifies owner
  const approveBatch = modDb.batch();
  approveBatch.update(modDb.doc('marketplaceListings/mkt_pending_1'), {
    approvalStatus: 'approved',
    status: 'active',
    visibility: 'public',
    approvedByUid: UID.moderator,
    approvedAt: serverTs(),
    expiresAt: tsFromMs(Date.now() + 7 * 86_400_000),
    updatedAt: serverTs(),
  });
  approveBatch.set(modDb.doc('adminAuditLogs/mkt_approve_log_1'), {
    id: 'mkt_approve_log_1',
    action: 'marketplace_approved',
    targetCollection: 'marketplaceListings',
    targetId: 'mkt_pending_1',
    performedByUid: UID.moderator,
    performedByRole: 'moderator',
    createdAt: serverTs(),
  });
  approveBatch.set(modDb.doc('notifications/mkt_notif_1'), {
    id: 'mkt_notif_1',
    recipientUid: UID.member,
    eventType: 'marketplace_approved',
    title: 'Listing Approved',
    actorUid: UID.moderator,
    isRead: false,
    createdAt: serverTs(),
  });
  await assertSucceeds(approveBatch.commit());

  // Verified Member can publish directly as approved/active
  await assertSucceeds(
    verifiedDb.doc('marketplaceListings/mkt_verified_1').set({
      id: 'mkt_verified_1',
      ownerUID: UID.verified,
      listingKind: 'service',
      title: 'Laptop Repair & Diagnostics',
      description: 'Fast student laptop diagnostics on campus.',
      category: 'services',
      price: 5000,
      quantity: 3,
      whatsappNumber: '+2348098765432',
      approvalStatus: 'approved',
      status: 'active',
      visibility: 'public',
      createdAt: serverTs(),
      updatedAt: serverTs(),
      expiresAt: tsFromMs(Date.now() + 7 * 86_400_000),
    })
  );
});
