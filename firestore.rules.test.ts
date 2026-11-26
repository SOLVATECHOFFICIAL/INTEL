import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesText = fs.readFileSync(path.resolve('firestore.rules'), 'utf8');
const blueprint = JSON.parse(
  fs.readFileSync(path.resolve('firebase-blueprint.json'), 'utf8')
) as {
  entities: Record<string, { properties: Record<string, { maxLength?: number; pattern?: string }> }>;
  firestore: Record<string, unknown>;
};

test('firestore.rules enforces default deny and verified email identity checks', () => {
  assert.match(rulesText, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  assert.match(rulesText, /request\.auth\.token\.email_verified == true/);
});

test('all 28 blueprint collections have explicit rules in firestore.rules', () => {
  const expectedCollections = [
    'users',
    'privateUserData',
    'userRoles',
    'badgeAuditLogs',
    'adminAuditLogs',
    'usernames',
    'posts',
    'postComments',
    'follows',
    'postReactions',
    'postViews',
    'updates',
    'adminUpdateMappings',
    'anonymousPosts',
    'anonymousComments',
    'anonymousIdentityMappings',
    'anonymousAuditLogs',
    'anonymousReports',
    'mediaImages',
    'savedPosts',
    'marketplaceListings',
    'marketplaceUpdates',
    'trustedContacts',
    'opportunities',
    'events',
    'notifications',
    'polls',
    'platformSettings',
  ];

  for (const name of expectedCollections) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(
        blueprint.firestore,
        `/${name}/${name === 'usernames' ? '{username}' : name === 'users' || name === 'privateUserData' || name === 'userRoles' ? '{userId}' : ''}`.replace(/\/$/, '')
      ) || Object.keys(blueprint.firestore).some((key) => key.startsWith(`/${name}/`)),
      `Blueprint missing collection ${name}`
    );
    assert.ok(
      rulesText.includes(`match /${name}/`),
      `firestore.rules missing match block for ${name}`
    );
  }
});

test('anonymous identity protection and moderator conflict rules are enforced in firestore.rules', () => {
  // Anonymous posts and comments must never allow author UID keys
  assert.doesNotMatch(
    rulesText.slice(
      rulesText.indexOf('function isValidAnonymousPost'),
      rulesText.indexOf('function isValidAnonymousComment')
    ),
    /ownerUID|authorUid/
  );

  // Anonymous identity mappings forbid Moderator and ordinary Admin reads (only designated Supreme Admins)
  const mappingBlock = rulesText.slice(
    rulesText.indexOf('match /anonymousIdentityMappings/{entryId}'),
    rulesText.indexOf('match /anonymousAuditLogs/{auditId}')
  );
  assert.match(mappingBlock, /allow get: if isValidId\(entryId\) && isAuthorizedAnonymousRevealAdmin\(\);/);
  assert.match(mappingBlock, /allow list: if isAuthorizedAnonymousRevealAdmin\(\);/);

  // Moderator deletion on anonymousPosts, anonymousComments, and ordinary posts enforces authorRole/role == 'member'
  assert.match(
    rulesText,
    /isModerator\(\) && get\(\/databases\/\$\(database\)\/documents\/anonymousIdentityMappings\/\$\(postId\)\)\.data\.authorRole == 'member'/
  );
  assert.match(
    rulesText,
    /isModerator\(\) && get\(\/databases\/\$\(database\)\/documents\/anonymousIdentityMappings\/\$\(commentId\)\)\.data\.authorRole == 'member'/
  );
  assert.match(
    rulesText,
    /isModerator\(\) && \(!hasRoleDoc\(existing\(\)\.ownerUID\) \|\| roleDoc\(existing\(\)\.ownerUID\)\.role == 'member'\)/
  );
});

test('two-admin lock, no legacy owner escalation, badge audit log immutability, role-badge sync, and marketplace no-double-approval rules are enforced', () => {
  assert.doesNotMatch(rulesText, /function isPermanentOwner/);
  assert.doesNotMatch(rulesText, /function isTargetPermanentOwner/);
  assert.doesNotMatch(rulesText, /function isSupremeAdminOrOwner/);
  assert.doesNotMatch(rulesText, /estheriawoyinfa52/i);
  assert.match(rulesText, /function isSupremeAdmin\(\)/);
  assert.match(rulesText, /request\.auth\.token\.email\.trim\(\)\.lower\(\)/);
  assert.match(rulesText, /data\.isPermanentOwner == false/);
  assert.match(rulesText, /function isRoleBadgeConsistent\(role, badge\)/);
  assert.match(rulesText, /userId != request\.auth\.uid/);
  assert.match(rulesText, /match \/badgeAuditLogs\/\{logId\}/);
  assert.match(rulesText, /allow update, delete: if false;/);
  assert.match(rulesText, /existing\(\)\.approvalStatus == 'pending_approval'/);
  assert.match(rulesText, /incoming\(\)\.approvedAt == request\.time/);
  assert.match(rulesText, /data\.entryType == 'admin_listed_contact'/);
  assert.match(rulesText, /data\.isUserAccount == false/);
});

test('username uniqueness, reserved names, follow determinism, and atomic counters are enforced', () => {
  assert.match(rulesText, /function isReservedUsername\(username\)/);
  assert.match(rulesText, /!isReservedUsername\(data\.username\)/);
  assert.match(rulesText, /followId == request\.auth\.uid \+ '_' \+ incoming\(\)\.targetUid/);
  assert.match(rulesText, /incoming\(\)\.targetUid != request\.auth\.uid/);
  assert.match(rulesText, /existsAfter\(\/databases\/\$\(database\)\/documents\/follows\/\$\(request\.auth\.uid \+ '_' \+ userId\)\)/);
  assert.match(rulesText, /existing\(\)\.ownerUID == request\.auth\.uid/);
});

test('mediaImages rules enforce 4-image post cap, strict Base64 size bounds, and anonymous ownerUID exclusion', () => {
  const mediaListFn = rulesText.slice(
    rulesText.indexOf('function isValidMediaItemsList('),
    rulesText.indexOf('function isValidPhotoOnlyMediaItemValues(')
  );
  assert.match(mediaListFn, /let n = items\.size\(\);\s*return items is list &&\s*n <= 4/);
  assert.match(rulesText, /isValidMediaItemsArray\(data, key\)/);
  assert.match(rulesText, /data\.base64Data\.size\(\) <= 340000/);
  assert.match(rulesText, /data\.byteSize <= 250000/);
  assert.match(rulesText, /data\.targetCollection == 'anonymousPosts' && !\('ownerUID' in data\)/);
  assert.match(rulesText, /isAllowedImageMimeType\(data\.mimeType\)/);
  assert.match(rulesText, /'image\/png'/);
  assert.match(rulesText, /'image\/gif'/);
  assert.match(rulesText, /'image\/heic'/);
  assert.match(rulesText, /!existsAfter\(\/databases\/\$\(database\)\/documents\/posts\/\$\(existing\(\)\.postId\)\)/);
  assert.match(rulesText, /!existsAfter\(\/databases\/\$\(database\)\/documents\/anonymousPosts\/\$\(existing\(\)\.postId\)\)/);
});

test('profile accountCategory, private anonymousHistory subcollection, and anonymous postReactions isolation are enforced', () => {
  assert.match(rulesText, /'accountCategory'/);
  assert.match(rulesText, /isOptionalShortString\(data, 'accountCategory', 64\)/);
  assert.match(rulesText, /match \/anonymousHistory\/\{postId\}/);
  assert.match(rulesText, /allow get, list: if isValidId\(userId\) && isOwnerOf\(userId\);/);
  assert.match(rulesText, /allow update: if false;/);
  assert.match(
    rulesText,
    /allow get: if isValidId\(reactionId\) && \(\s*\(resource == null && isSignedIn\(\)\) \|\|/
  );
  assert.match(
    rulesText,
    /allow list: if existing\(\)\.targetCollection == 'posts' \|\|/
  );
  assert.match(
    rulesText,
    /\(isSignedIn\(\) && existing\(\)\.ownerUID == request\.auth\.uid\)/
  );
});

test('Prompt 6 adminAuditLogs immutability, scoped moderator boundaries, and collaborative admin management are enforced', () => {
  const adminLogBlock = rulesText.slice(
    rulesText.indexOf('match /adminAuditLogs/{logId}'),
    rulesText.indexOf('match /usernames/{username}')
  );
  assert.match(adminLogBlock, /allow get, list: if isSupremeAdmin\(\);/);
  assert.match(adminLogBlock, /allow update, delete: if false;/);
  assert.match(
    adminLogBlock,
    /isModerator\(\) && incoming\(\)\.action in \[\s*'marketplace_approved', 'marketplace_rejected',\s*'post_deleted', 'anonymous_post_deleted',\s*'post_comment_deleted', 'anonymous_comment_deleted',\s*'anonymous_report_dismissed', 'anonymous_report_removed'\s*\]/
  );

  // Moderator notification create strictly limited to marketplace decisions
  assert.match(
    rulesText,
    /\(isModerator\(\) && incoming\(\)\.eventType in \['marketplace_approved', 'marketplace_rejected'\]/
  );

  // Moderator marketplace review strictly limited to ordinary members
  assert.match(
    rulesText,
    /isModerator\(\) && \(!hasRoleDoc\(existing\(\)\.ownerUID\) \|\| roleDoc\(existing\(\)\.ownerUID\)\.role == 'member'\)/
  );

  // Moderator cannot delete marketplace listings directly
  const marketplaceBlock = rulesText.slice(
    rulesText.indexOf('match /marketplaceListings/{listingId}'),
    rulesText.indexOf('match /trustedContacts/{contactId}')
  );
  assert.doesNotMatch(
    marketplaceBlock.slice(marketplaceBlock.indexOf('allow delete:')),
    /isModerator\(\)/
  );

  // Moderator can delete mediaImages belonging to ordinary community posts
  assert.match(
    rulesText,
    /existing\(\)\.targetCollection == 'posts' && isModerator\(\) && 'ownerUID' in existing\(\) && isValidId\(existing\(\)\.ownerUID\) && \(!hasRoleDoc\(existing\(\)\.ownerUID\) \|\| roleDoc\(existing\(\)\.ownerUID\)\.role == 'member'\)/
  );

  // Platform settings support admin operational toggles without unauthenticated writes
  const settingsBlock = rulesText.slice(
    rulesText.indexOf('match /platformSettings/{settingId}')
  );
  assert.match(rulesText, /'marketplaceSubmissionsOpen'/);
  assert.match(rulesText, /'anonymousPostingOpen'/);
  assert.match(rulesText, /'newRegistrationsOpen'/);
  assert.match(settingsBlock, /allow delete: if isSupremeAdmin\(\)/);
});

test('Prompt 7 ordinary feed rules enforce role/badge sync, two separate post formats, and target post existence for interactions', () => {
  assert.match(rulesText, /function isValidPublishRoleAndBadge\(uid\)/);
  assert.match(rulesText, /function canPublishFeed\(\) \{\s*return isActiveSignedInUser\(\) &&\s*isValidPublishRoleAndBadge\(request\.auth\.uid\)/);
  assert.match(rulesText, /function isValidTextPostBackgroundStyle\(style\)/);
  assert.match(rulesText, /function isValidPhotoOnlyMediaItemMap\(item\)/);
  assert.match(rulesText, /function isValidPhotoPostMediaItemsArray\(data\)/);
  assert.match(rulesText, /function isValidTypedCommunityPost\(data, postId\)/);

  // Posts create enforces typed post rules and author update locks postType
  const postsBlock = rulesText.slice(
    rulesText.indexOf('match /posts/{postId}'),
    rulesText.indexOf('match /postComments/{commentId}')
  );
  assert.match(postsBlock, /isValidTypedCommunityPost\(incoming\(\), postId\)/);
  assert.match(postsBlock, /!\('postType' in existing\(\)\) \|\| incoming\(\)\.postType == existing\(\)\.postType/);

  // Reactions and comments verify target post exists and is published
  assert.match(rulesText, /get\(\/databases\/\$\(database\)\/documents\/posts\/\$\(incoming\(\)\.postId\)\)\.data\.status == 'published'/);
  assert.match(rulesText, /get\(\/databases\/\$\(database\)\/documents\/posts\/\$\(incoming\(\)\.targetId\)\)\.data\.status == 'published'/);

  // Blueprint and composite index checks
  const postProps = blueprint.entities.CommunityPost.properties;
  assert.ok('postType' in postProps);
  assert.ok('backgroundStyle' in postProps);

  const indexesJson = JSON.parse(
    fs.readFileSync(path.resolve('firestore.indexes.json'), 'utf8')
  ) as {
    indexes: { collectionGroup: string; fields: { fieldPath: string; order: string }[] }[];
  };
  const hasPostsCreatedAtIndex = indexesJson.indexes.some(
    (idx) =>
      idx.collectionGroup === 'posts' &&
      idx.fields[0]?.fieldPath === 'status' &&
      idx.fields[1]?.fieldPath === 'createdAt' &&
      idx.fields[1]?.order === 'DESCENDING'
  );
  assert.equal(hasPostsCreatedAtIndex, true);
});

test('isActiveAccount and currentRoleString guard missing fields safely without weakening suspension checks', () => {
  assert.match(
    rulesText,
    /function isActiveAccount\(uid\) \{\s*return !exists\(\/databases\/\$\(database\)\/documents\/users\/\$\(uid\)\) \|\|\s*!\('accountStatus' in get\(\/databases\/\$\(database\)\/documents\/users\/\$\(uid\)\)\.data\) \|\|\s*get\(\/databases\/\$\(database\)\/documents\/users\/\$\(uid\)\)\.data\.accountStatus != 'suspended';/
  );
  assert.match(
    rulesText,
    /function currentRoleString\(\) \{\s*return isDesignatedSupremeAdminEmail\(\)\s*\? 'supreme_admin'\s*: \(hasRoleDoc\(request\.auth\.uid\) &&\s*'role' in roleDoc\(request\.auth\.uid\) &&/
  );
  assert.match(
    rulesText,
    /allow get: if isValidId\(postId\) && \(\s*resource == null \|\|\s*existing\(\)\.status == 'published'/
  );
  assert.match(
    rulesText,
    /allow get: if isValidId\(postId\) && \(resource == null \|\| existing\(\)\.status == 'published'\);/
  );
  assert.match(
    rulesText,
    /allow get: if isValidId\(commentId\) && \(resource == null \|\| existing\(\)\.status == 'published'\);/
  );
});

test('Prompt 8 anonymous community rules enforce strict text vs photo formats, comment likes, and moderation reports without exposing author identities', () => {
  assert.match(rulesText, /function isValidTypedAnonymousPost\(data, postId\)/);
  assert.match(rulesText, /function isValidAnonymousReport\(data, reportId\)/);

  const anonPostsBlock = rulesText.slice(
    rulesText.indexOf('match /anonymousPosts/{postId}'),
    rulesText.indexOf('match /anonymousComments/{commentId}')
  );
  assert.match(anonPostsBlock, /isValidTypedAnonymousPost\(incoming\(\), postId\)/);
  assert.match(
    anonPostsBlock,
    /!\('postType' in existing\(\)\) \|\| incoming\(\)\.postType == existing\(\)\.postType/
  );

  // Anonymous comment & nested reply likes sync with postReactions while remaining private
  assert.match(
    rulesText,
    /incoming\(\)\.targetCollection in \['posts', 'anonymousPosts', 'anonymousComments'\]/
  );
  assert.match(
    rulesText,
    /'anonymousComments_' \+ commentId \+ '_' \+ request\.auth\.uid/
  );

  // Anonymous reports never expose target author UIDs and keep deterministic reporter keys
  const reportsBlock = rulesText.slice(
    rulesText.indexOf('match /anonymousReports/{reportId}'),
    rulesText.indexOf('// 5. Media Images')
  );
  assert.match(reportsBlock, /isValidAnonymousReport\(incoming\(\), reportId\)/);
  assert.match(
    reportsBlock,
    /reportId == data\.targetType \+ '_' \+ data\.targetId \+ '_' \+ data\.reporterUid|isSupremeAdmin\(\) \|\| isModerator\(\)/
  );
  assert.doesNotMatch(
    rulesText.slice(
      rulesText.indexOf('function isValidAnonymousReport'),
      rulesText.indexOf('function isValidIdentityMapping')
    ),
    /authorUid|ownerUID/
  );
});

test('Prompt 10 follow notifications and Trusted Circle media/category rules are enforced', () => {
  assert.match(rulesText, /incoming\(\)\.eventType == 'follow'/);
  assert.match(
    rulesText,
    /!exists\(\/databases\/\$\(database\)\/documents\/follows\/\$\(request\.auth\.uid \+ '_' \+ incoming\(\)\.recipientUid\)\)/
  );
  assert.match(
    rulesText,
    /existsAfter\(\/databases\/\$\(database\)\/documents\/follows\/\$\(request\.auth\.uid \+ '_' \+ incoming\(\)\.recipientUid\)\)/
  );
  assert.match(
    rulesText,
    /incoming\(\)\.targetCollection == 'trustedContacts' &&\s*isSupremeAdmin\(\)/
  );
  assert.match(rulesText, /'officially_verified'/);
  assert.match(rulesText, /'community_recommended'/);
  assert.match(rulesText, /isOptionalValidImageId\(data, 'photoImageId'\)/);
});

test('Task 11 opportunities rules enforce 9 categories, unpublished draft isolation, verification, and notification safety', () => {
  const oppFn = rulesText.slice(
    rulesText.indexOf('function isValidOpportunity'),
    rulesText.indexOf('function isValidCampusEvent')
  );
  assert.match(oppFn, /'conference'/);
  assert.match(oppFn, /'other'/);
  assert.match(oppFn, /'whoCanApply'/);
  assert.match(oppFn, /'opensAt'/);
  assert.match(oppFn, /'isVerified'/);
  assert.match(oppFn, /'notifiedNewAt'/);
  assert.match(oppFn, /'lastDeadlineNotifiedMs'/);
  assert.match(oppFn, /data\.status in \['active', 'expired', 'unpublished'\]/);

  const oppMatchBlock = rulesText.slice(
    rulesText.indexOf('match /opportunities/{opportunityId}'),
    rulesText.indexOf('match /events/{eventId}')
  );
  assert.match(
    oppMatchBlock,
    /existing\(\)\.status in \['active', 'expired'\] \|\| isSupremeAdmin\(\)/
  );
  assert.match(
    oppMatchBlock,
    /allow list: if existing\(\)\.status in \['active', 'expired'\] \|\| isSupremeAdmin\(\);/
  );
});

test('Task 12 events rules enforce 10 categories, draft isolation, mediaImages, savedPosts, and atomic likes/comments', () => {
  const eventFn = rulesText.slice(
    rulesText.indexOf('function isValidCampusEvent'),
    rulesText.indexOf('function isValidNotification')
  );
  for (const cat of [
    'departmental',
    'faculty',
    'student_association',
    'seminar_workshop',
    'conference',
    'orientation',
    'public_lecture',
    'competition',
    'social_cultural',
    'other',
  ]) {
    assert.ok(eventFn.includes(`'${cat}'`), `Missing event category ${cat}`);
  }
  assert.match(eventFn, /'mediaItems'/);
  assert.match(eventFn, /'endDate'/);
  assert.match(eventFn, /'registrationRequired'/);
  assert.match(eventFn, /'published'/);
  assert.match(eventFn, /'ongoing'/);
  assert.match(eventFn, /'completed'/);

  const eventMatchBlock = rulesText.slice(
    rulesText.indexOf('match /events/{eventId}'),
    rulesText.indexOf('// 10. Notifications')
  );
  assert.match(eventMatchBlock, /isEventPublished\(existing\(\)\) \|\| isSupremeAdmin\(\)/);
  assert.match(eventMatchBlock, /'events_' \+ eventId \+ '_' \+ request\.auth\.uid/);
  assert.match(eventMatchBlock, /hasOnly\(\['commentsCount'\]\)/);

  assert.match(
    rulesText,
    /incoming\(\)\.targetCollection == 'events' &&\s*isSupremeAdmin\(\)/
  );
  assert.match(
    rulesText,
    /incoming\(\)\.targetCollection in \['posts', 'updates', 'anonymousPosts', 'marketplaceListings', 'opportunities', 'events'\]/
  );
  assert.match(
    rulesText,
    /incoming\(\)\.targetCollection in \['events', 'updates', 'postComments'\]/
  );
});

test('Task 13 notification rules enforce actor isolation, zero-actor anonymous reply protection, and marketplace comments', () => {
  const notifFn = rulesText.slice(
    rulesText.indexOf('function isValidNotification'),
    rulesText.indexOf('function isValidCampusPoll')
  );
  assert.match(notifFn, /'targetImageId'/);
  assert.match(notifFn, /'targetImageUrl'/);

  const notifBlock = rulesText.slice(
    rulesText.indexOf('match /notifications/{notificationId}'),
    rulesText.indexOf('match /polls/{pollId}')
  );
  assert.match(
    notifBlock,
    /incoming\(\)\.eventType in \['reaction', 'comment', 'reply', 'mention'\]/
  );
  assert.match(notifBlock, /incoming\(\)\.actorUid == request\.auth\.uid/);
  assert.match(notifBlock, /incoming\(\)\.recipientUid != request\.auth\.uid/);
  assert.match(notifFn, /'anonymous_reaction'/);
  assert.match(notifBlock, /incoming\(\)\.eventType in \['anonymous_reply', 'anonymous_reaction'\]/);
  assert.match(notifBlock, /!\('actorUid' in incoming\(\)\)/);
  assert.match(notifBlock, /!\('actorUsername' in incoming\(\)\)/);
  assert.match(notifBlock, /!\('actorName' in incoming\(\)\)/);
  assert.match(notifBlock, /incoming\(\)\.eventType == 'marketplace_expired'/);
  assert.match(
    rulesText,
    /incoming\(\)\.targetCollection == 'marketplaceListings'/
  );
  assert.match(rulesText, /'announcement_broadcast'/);
});

test('Prompt 20 designated Supreme Admins, underground privacy, compulsory Trust WhatsApp, postViews, and marketplaceUpdates rules are enforced', () => {
  assert.match(rulesText, /lasuedintel@gmail\.com/);
  assert.match(rulesText, /awoyinfasolomon1@gmail\.com/);
  assert.match(rulesText, /function isAuthorizedAnonymousRevealAdmin\(\)/);

  const privateBlock = rulesText.slice(
    rulesText.indexOf('match /privateUserData/{userId}'),
    rulesText.indexOf('match /anonymousHistory/{postId}')
  );
  assert.match(privateBlock, /allow get: if isValidId\(userId\) && isOwnerOf\(userId\);/);
  assert.match(privateBlock, /incoming\(\)\.showSupremeAdminBadge == false/);
  assert.doesNotMatch(privateBlock, /isPermanentOwner\(\)/);

  const trustFn = rulesText.slice(
    rulesText.indexOf('function isValidTrustedContact'),
    rulesText.indexOf('function isValidOpportunity')
  );
  assert.match(trustFn, /contactNumber/);
  assert.match(trustFn, /whatsappLink/);
  assert.match(trustFn, /wa\\\\\.me\|api\\\\\.whatsapp\\\\\.com/);

  const postViewsBlock = rulesText.slice(
    rulesText.indexOf('match /postViews/{viewId}'),
    rulesText.indexOf('// 4. Anonymous Community')
  );
  assert.match(postViewsBlock, /allow get, list: if false;/);
  assert.match(postViewsBlock, /allow update, delete: if false;/);
  assert.match(postViewsBlock, /viewId == incoming\(\)\.targetCollection \+ '_' \+ incoming\(\)\.targetId \+ '_' \+ request\.auth\.uid/);

  const mktUpdatesStart = rulesText.indexOf('match /marketplaceUpdates/{updateId}');
  const mktUpdatesBlock = rulesText.slice(mktUpdatesStart);
  assert.match(mktUpdatesBlock, /allow create, update: if isValidId\(updateId\) &&[\s\S]*isSupremeAdmin\(\)/);
  assert.match(mktUpdatesBlock, /allow delete: if isValidId\(updateId\) && isSupremeAdmin\(\);/);
});

test('Audit fixes enforce resource==null reads, unfollow decrements on suspended targets, and hardened marketplace seller lifecycle', () => {
  const usersBlock = rulesText.slice(
    rulesText.indexOf('match /users/{userId}'),
    rulesText.indexOf('match /privateUserData/{userId}')
  );
  // Missing user doc lookups must return exists==false cleanly rather than permission-denied
  assert.match(usersBlock, /allow get: if isValidId\(userId\) && \(\s*resource == null \|\|/);
  // Unfollowing / self-delete cleanup (-1) must not fail when target is suspended, while +1 still requires active signed-in + active target
  assert.match(
    usersBlock,
    /\(isActiveSignedInUser\(\) &&\s*\(!\('accountStatus' in existing\(\)\) \|\| existing\(\)\.accountStatus == 'active'\) &&\s*incoming\(\)\.followersCount == \(\('followersCount' in existing\(\) && existing\(\)\.followersCount is int \? existing\(\)\.followersCount : 0\) \+ 1\)/
  );
  assert.match(
    usersBlock,
    /\('followersCount' in existing\(\) &&\s*existing\(\)\.followersCount is int &&\s*existing\(\)\.followersCount > 0 &&\s*incoming\(\)\.followersCount == existing\(\)\.followersCount - 1/
  );

  // Notifications allow get supports deterministic existence checks (resource == null)
  const notifBlock = rulesText.slice(
    rulesText.indexOf('match /notifications/{notificationId}'),
    rulesText.indexOf('match /polls/{pollId}')
  );
  assert.match(
    notifBlock,
    /allow get: if isValidId\(notificationId\) && isSignedIn\(\) && \(\s*resource == null \|\|\s*existing\(\)\.recipientUid == request\.auth\.uid/
  );

  // Marketplace seller update separates pending_approval (anti-escalation) from approved (active/sold/expired renew/restock + visibility restore + 8d expiry cap)
  const marketplaceBlock = rulesText.slice(
    rulesText.indexOf('match /marketplaceListings/{listingId}'),
    rulesText.indexOf('match /trustedContacts/{contactId}')
  );
  assert.match(
    marketplaceBlock,
    /existing\(\)\.approvalStatus == 'pending_approval' &&\s*existing\(\)\.status == 'pending_approval' &&\s*incoming\(\)\.approvalStatus == 'pending_approval' &&\s*incoming\(\)\.status == 'pending_approval'/
  );
  assert.match(
    marketplaceBlock,
    /existing\(\)\.approvalStatus == 'approved' &&\s*existing\(\)\.status in \['active', 'sold', 'expired'\]/
  );
  assert.match(
    marketplaceBlock,
    /incoming\(\)\.quantity >= 1 && incoming\(\)\.status == 'active' && incoming\(\)\.visibility == 'public'/
  );
  assert.match(
    marketplaceBlock,
    /incoming\(\)\.expiresAt <= request\.time \+ duration\.value\(8, 'd'\)/
  );
});

test('Official updates rules enforce strict two-admin publishing, underground official_desk isolation, separated photo/text formats, and atomic interactions', () => {
  const fnBlock = rulesText.slice(
    rulesText.indexOf('function isValidAdminUpdate('),
    rulesText.indexOf('function isValidPostComment(')
  );
  assert.match(fnBlock, /d\.format in \['photo', 'text'\]/);
  assert.match(fnBlock, /d\.authorMode in \['public_admin', 'official_desk'\]/);
  assert.match(fnBlock, /!\('ownerUID' in d\)/);
  assert.match(fnBlock, /LASUED Intel Official/);
  assert.match(fnBlock, /isValidPhotoPostMediaItemsArray\(d\)/);
  assert.match(fnBlock, /isValidTextPostBackgroundStyle\(d\.backgroundStyle\)/);

  const updatesBlock = rulesText.slice(
    rulesText.indexOf('match /updates/{updateId}'),
    rulesText.indexOf('match /adminUpdateMappings/{updateId}')
  );
  assert.match(updatesBlock, /allow create: if isValidId\(updateId\) &&[\s\S]*isSupremeAdmin\(\)/);
  assert.match(updatesBlock, /isUndergroundSupremeAdminEmail\(\) &&[\s\S]*incoming\(\)\.authorMode == 'official_desk' &&[\s\S]*!\('ownerUID' in incoming\(\)\)/);
  assert.match(updatesBlock, /'updates_' \+ updateId \+ '_' \+ request\.auth\.uid/);
  assert.match(updatesBlock, /hasOnly\(\['commentsCount'\]\)/);
  assert.match(updatesBlock, /allow delete: if isValidId\(updateId\) && isSupremeAdmin\(\);/);

  const mappingsBlock = rulesText.slice(
    rulesText.indexOf('match /adminUpdateMappings/{updateId}')
  );
  assert.match(mappingsBlock, /allow get, list: if isSupremeAdmin\(\);/);
  assert.match(mappingsBlock, /allow update: if false;/);

  const usersBlock = rulesText.slice(
    rulesText.indexOf('match /users/{userId}'),
    rulesText.indexOf('match /privateUserData/{userId}')
  );
  assert.match(usersBlock, /!\('hasPublicActivity' in incoming\(\)\) \|\| incoming\(\)\.hasPublicActivity == false/);

  assert.match(rulesText, /incoming\(\)\.targetCollection == 'updates'/);
  assert.match(rulesText, /'official_update'/);
  assert.match(rulesText, /'update_created'/);
  assert.match(rulesText, /'update_updated'/);
  assert.match(rulesText, /'update_deleted'/);
  assert.doesNotMatch(rulesText, /estheriawoyinfa52@gmail\.com/i);
});

test('Rebuilt rules enforce Supreme Admin self-sync, orphaned reaction cleanup, admin affectedKeys locks, state consistency, and required composite indexes', () => {
  // Designated Supreme Admin self-sync on users/{userId}
  const usersBlock = rulesText.slice(
    rulesText.indexOf('match /users/{userId}'),
    rulesText.indexOf('match /privateUserData/{userId}')
  );
  assert.match(
    usersBlock,
    /isDesignatedSupremeAdminEmail\(\) &&[\s\S]*isOwnerOf\(userId\) &&[\s\S]*incoming\(\)\.badge == \(isUndergroundSupremeAdminEmail\(\) \? 'none' : 'supreme_admin'\) &&[\s\S]*incoming\(\)\.isHiddenFromDirectory == isUndergroundSupremeAdminEmail\(\) &&[\s\S]*affectedKeys\(\)\.hasOnly\(\['badge', 'isHiddenFromDirectory', 'updatedAt'\]\)/
  );

  // Orphaned postReactions delete supports chunked cascade cleanup across all 6 target collections
  const reactionsBlock = rulesText.slice(
    rulesText.indexOf('match /postReactions/{reactionId}'),
    rulesText.indexOf('// 4. The Unfiltered')
  );
  for (const col of [
    'posts',
    'anonymousPosts',
    'anonymousComments',
    'events',
    'updates',
    'postComments',
  ]) {
    assert.match(
      reactionsBlock,
      new RegExp(
        `existing\\(\\)\\.targetCollection == '${col}' && \\(\\s*!exists\\(/databases/\\$\\(database\\)/documents/${col}/\\$\\(existing\\(\\)\\.targetId\\)\\) \\|\\|\\s*!existsAfter\\(/databases/\\$\\(database\\)/documents/${col}/\\$\\(existing\\(\\)\\.targetId\\)\\)`
      )
    );
  }

  // badgeAuditLogs requires active signed-in user
  const badgeAuditBlock = rulesText.slice(
    rulesText.indexOf('match /badgeAuditLogs/{logId}'),
    rulesText.indexOf('match /adminAuditLogs/{logId}')
  );
  assert.match(badgeAuditBlock, /isActiveSignedInUser\(\)/);

  // marketplaceListings approval state consistency & 8-day expiry cap
  const marketplaceBlock = rulesText.slice(
    rulesText.indexOf('match /marketplaceListings/{listingId}'),
    rulesText.indexOf('match /trustedContacts/{contactId}')
  );
  assert.match(
    marketplaceBlock,
    /\(incoming\(\)\.approvalStatus == 'approved' && incoming\(\)\.status == 'active' && incoming\(\)\.visibility == 'public'\) \|\|[\s\S]*\(incoming\(\)\.approvalStatus == 'rejected' && incoming\(\)\.status == 'rejected' && incoming\(\)\.visibility == 'owner_and_admins'\)/
  );

  // Moderator notification anti-spoof guard
  const notifBlock = rulesText.slice(
    rulesText.indexOf('match /notifications/{notificationId}'),
    rulesText.indexOf('match /polls/{pollId}')
  );
  assert.match(
    notifBlock,
    /isModerator\(\) && incoming\(\)\.eventType in \['marketplace_approved', 'marketplace_rejected'\] &&[\s\S]*incoming\(\)\.recipientUid != request\.auth\.uid &&[\s\S]*\(!\('actorUid' in incoming\(\)\) \|\| incoming\(\)\.actorUid == request\.auth\.uid\)/
  );

  // Immutability and affectedKeys locks across admin collections
  const trustedBlock = rulesText.slice(
    rulesText.indexOf('match /trustedContacts/{contactId}'),
    rulesText.indexOf('match /opportunities/{opportunityId}')
  );
  assert.match(trustedBlock, /incoming\(\)\.entryType == existing\(\)\.entryType/);
  assert.match(trustedBlock, /incoming\(\)\.isUserAccount == existing\(\)\.isUserAccount/);
  assert.match(trustedBlock, /affectedKeys\(\)\.hasOnly\(\[\s*'fullName', 'category', 'badgeLabel', 'roleTitle'/);

  const oppBlock = rulesText.slice(
    rulesText.indexOf('match /opportunities/{opportunityId}'),
    rulesText.indexOf('match /events/{eventId}')
  );
  assert.match(oppBlock, /affectedKeys\(\)\.hasOnly\(\[\s*'category', 'title', 'organisation', 'description'/);

  const eventBlock = rulesText.slice(
    rulesText.indexOf('match /events/{eventId}'),
    rulesText.indexOf('// 10. Notifications')
  );
  assert.match(eventBlock, /affectedKeys\(\)\.hasOnly\(\[\s*'category', 'title', 'description', 'bannerUrl', 'mediaItems'/);

  const pollsBlock = rulesText.slice(
    rulesText.indexOf('match /polls/{pollId}'),
    rulesText.indexOf('match /platformSettings/{settingId}')
  );
  assert.match(pollsBlock, /incoming\(\)\.ownerUID == existing\(\)\.ownerUID/);
  assert.match(pollsBlock, /affectedKeys\(\)\.hasOnly\(\[\s*'question', 'options', 'status', 'expiresAt'\s*\]\)/);
  assert.match(pollsBlock, /affectedKeys\(\)\.hasOnly\(\[\s*'question', 'description', 'options', 'status', 'expiresAt'/);
  const pollFnBlock = rulesText.slice(
    rulesText.indexOf('function isValidCampusPoll('),
    rulesText.indexOf('function isValidPollVote(')
  );
  assert.match(pollFnBlock, /isOptionalShortString\(d, 'description', 300\)/);
  assert.equal(blueprint.entities.CampusPoll.properties.description.maxLength, 300);

  const settingsBlock = rulesText.slice(
    rulesText.indexOf('match /platformSettings/{settingId}'),
    rulesText.indexOf('// 11. Deduplicated Post Views')
  );
  assert.match(settingsBlock, /affectedKeys\(\)\.hasOnly\(\[\s*'updatedByUid', 'pinnedAnnouncementPostId', 'maintenanceNotice'/);

  assert.match(rulesText, /function isValidMarketplaceUpdate\(data, updateId\)/);
  const mktUpdatesBlock = rulesText.slice(
    rulesText.indexOf('match /marketplaceUpdates/{updateId}'),
    rulesText.indexOf('// 12. Official Administrator Updates')
  );
  assert.match(mktUpdatesBlock, /isValidMarketplaceUpdate\(incoming\(\), updateId\)/);
  assert.match(mktUpdatesBlock, /affectedKeys\(\)\.hasOnly\(\[\s*'title', 'body', 'category', 'published', 'updatedAt'\s*\]\)/);

  // Full element validation bounds for isValidMediaArray [0..5] and isValidCampusPoll options [0..7]
  assert.match(rulesText, /data\[key\]\[5\] is string && data\[key\]\[5\]\.size\(\) <= 512/);
  assert.match(pollFnBlock, /opts\[7\] is string && opts\[7\]\.size\(\) >= 1 && opts\[7\]\.size\(\) <= 120/);

  // Required composite indexes present in firestore.indexes.json
  const indexesJson = JSON.parse(
    fs.readFileSync(path.resolve('firestore.indexes.json'), 'utf8')
  ) as {
    indexes: { collectionGroup: string; fields: { fieldPath: string; order: string }[] }[];
  };
  const hasIndex = (group: string, fields: string[]) =>
    indexesJson.indexes.some(
      (idx) =>
        idx.collectionGroup === group &&
        idx.fields.length === fields.length &&
        fields.every((fp, i) => idx.fields[i]?.fieldPath === fp)
    );

  assert.equal(hasIndex('marketplaceListings', ['ownerUID', 'status']), true);
  assert.equal(hasIndex('notifications', ['recipientUid', 'isRead']), true);
  assert.equal(hasIndex('savedPosts', ['ownerUID', 'targetId']), true);
  assert.equal(hasIndex('savedPosts', ['ownerUID', 'targetCollection', 'targetId']), true);
});

test('Granted verified and moderator roles exercise real permissions without email_verified blocker while Supreme Admin retains strict email_verified lock', () => {
  const helpersBlock = rulesText.slice(
    rulesText.indexOf('function isDesignatedSupremeAdminEmail()'),
    rulesText.indexOf('function canPublishFeed()')
  );

  // Strict email_verified lock preserved on designated Supreme Admins
  assert.match(
    helpersBlock,
    /function isDesignatedSupremeAdminEmail\(\) \{\s*return isVerifiedEmailUser\(\)/
  );
  assert.match(
    helpersBlock,
    /function isUndergroundSupremeAdminEmail\(\) \{\s*return isVerifiedEmailUser\(\)/
  );

  // Granted moderator & verified roles do not require isVerifiedEmailUser(), and explicitly block legacy isPermanentOwner == true
  const modBlock = rulesText.slice(
    rulesText.indexOf('function isModerator()'),
    rulesText.indexOf('function isVerifiedMember()')
  );
  assert.doesNotMatch(modBlock, /isVerifiedEmailUser\(\)/);
  assert.match(modBlock, /isActiveSignedInUser\(\)/);
  assert.match(modBlock, /isPermanentOwner == false/);

  const verifiedBlock = rulesText.slice(
    rulesText.indexOf('function isVerifiedMember()'),
    rulesText.indexOf('function currentRoleString()')
  );
  assert.doesNotMatch(verifiedBlock, /isVerifiedEmailUser\(\)/);
  assert.match(verifiedBlock, /isActiveSignedInUser\(\)/);
  assert.match(verifiedBlock, /isPermanentOwner == false/);

  const publishBlock = rulesText.slice(
    rulesText.indexOf('function isValidPublishRoleUserData('),
    rulesText.indexOf('function canPublishFeed()')
  );
  assert.match(publishBlock, /isPermanentOwner == false/);

  // Ordinary community post deletion allows active authors (e.g. granted verified/moderator) and moderators without global email_verified gate
  const postsDeleteLine = rulesText.slice(
    rulesText.indexOf('allow delete: if isValidId(postId)'),
    rulesText.indexOf('match /postComments/{commentId}')
  );
  assert.doesNotMatch(postsDeleteLine, /isVerifiedEmailUser\(\)/);
  assert.match(postsDeleteLine, /isActiveSignedInUser\(\)/);
});

test('Audit regression: admin follows, legacy counter-only likes/comments/views, 340k media ceiling, and lean batch access rules', () => {
  const usersBlock = rulesText.slice(
    rulesText.indexOf('match /users/{userId}'),
    rulesText.indexOf('match /privateUserData/{userId}')
  );
  // users allow update must not run isValidPublicUser (reserved username check) on follow counters or governance updates
  assert.doesNotMatch(usersBlock.slice(usersBlock.indexOf('allow update:')), /isValidPublicUser\(incoming\(\)/);
  assert.match(usersBlock, /isValidPublicUserProfileEdit\(incoming\(\), existing\(\), userId\)/);
  assert.match(usersBlock, /affectedKeys\(\)\.hasOnly\(\['followingCount', 'updatedAt'\]\)/);
  assert.match(usersBlock, /affectedKeys\(\)\.hasOnly\(\['hasPublicActivity', 'anonymousLikesReceivedCount', 'updatedAt'\]\)/);

  // follows create guards legacy profiles missing accountStatus / followersCount / followingCount
  const followsBlock = rulesText.slice(
    rulesText.indexOf('match /follows/{followId}'),
    rulesText.indexOf('match /postReactions/{reactionId}')
  );
  assert.match(followsBlock, /!\('accountStatus' in get\(/);
  assert.match(followsBlock, /'followersCount' in get\(/);
  assert.match(followsBlock, /'followingCount' in get\(/);

  // canPublishFeed removes redundant re-reads and mediaImages uses ternary exists/existsAfter with 340000 Base64 cap
  assert.doesNotMatch(
    rulesText.slice(
      rulesText.indexOf('function canPublishFeed()'),
      rulesText.indexOf('function isReservedUsername(')
    ),
    /isSupremeAdmin\(\) \|\| isModerator\(\)/
  );
  const mediaBlock = rulesText.slice(
    rulesText.indexOf('match /mediaImages/{imageId}'),
    rulesText.indexOf('match /savedPosts/{savedId}')
  );
  assert.match(mediaBlock, /exists\(\/databases\/\$\(database\)\/documents\/posts\/\$\(incoming\(\)\.targetId\)\)\s*\?/);

  // Counter-only likes/comments/views updates on posts, postComments, anonymousPosts, anonymousComments, events, updates, marketplaceListings
  // bypass full-document schema validators so legacy docs never fail on likes/comments/views
  const postsBlock = rulesText.slice(
    rulesText.indexOf('match /posts/{postId}'),
    rulesText.indexOf('match /postComments/{commentId}')
  );
  const postsUpdate = postsBlock.slice(postsBlock.indexOf('allow update:'));
  assert.ok(
    postsUpdate.indexOf("hasOnly(['likesCount'])") < postsUpdate.indexOf('isValidCommunityPost(incoming(), postId)')
  );

  const commentsBlock = rulesText.slice(
    rulesText.indexOf('match /postComments/{commentId}'),
    rulesText.indexOf('match /follows/{followId}')
  );
  const commentsUpdate = commentsBlock.slice(commentsBlock.indexOf('allow update:'));
  assert.ok(
    commentsUpdate.indexOf("hasOnly(['likesCount'])") < commentsUpdate.indexOf('isValidPostComment(incoming(), commentId)')
  );

  const eventsBlock = rulesText.slice(
    rulesText.indexOf('match /events/{eventId}'),
    rulesText.indexOf('// 10. Notifications')
  );
  const eventsUpdate = eventsBlock.slice(eventsBlock.indexOf('allow update:'));
  assert.ok(
    eventsUpdate.indexOf("hasOnly(['likesCount'])") < eventsUpdate.indexOf('isValidCampusEvent(incoming(), eventId)')
  );

  const updatesBlock = rulesText.slice(
    rulesText.indexOf('match /updates/{updateId}'),
    rulesText.indexOf('match /adminUpdateMappings/{updateId}')
  );
  const updatesUpdate = updatesBlock.slice(updatesBlock.indexOf('allow update:'));
  assert.ok(
    updatesUpdate.indexOf("hasOnly(['likesCount'])") < updatesUpdate.indexOf('isValidAdminUpdate(incoming(), updateId)')
  );

  // Base64 limit matches 250000-byte binary cap across blueprint and rules
  assert.equal(blueprint.entities.MediaImage.properties.base64Data.maxLength, 340000);
});

test('Guest and account deduplicated views across posts, anonymousPosts, and updates plus Supreme Admin backfill are enforced', () => {
  const postViewsBlock = rulesText.slice(
    rulesText.indexOf('match /postViews/{viewId}'),
    rulesText.indexOf('match /marketplaceUpdates/{updateId}')
  );
  assert.match(postViewsBlock, /incoming\(\)\.targetCollection in \['posts', 'anonymousPosts', 'updates'\]/);
  assert.match(postViewsBlock, /incoming\(\)\.visitorKey\.matches\('\^guest_\[a-zA-Z0-9_\\\\-\]\{8,58\}\$'\)/);
  assert.match(postViewsBlock, /viewId == incoming\(\)\.targetCollection \+ '_' \+ incoming\(\)\.targetId \+ '_' \+ incoming\(\)\.visitorKey/);

  const updatesBlock = rulesText.slice(
    rulesText.indexOf('match /updates/{updateId}'),
    rulesText.indexOf('match /adminUpdateMappings/{updateId}')
  );
  assert.match(updatesBlock, /\(!\('viewsCount' in incoming\(\)\) \|\| incoming\(\)\.viewsCount == 0\)/);
  assert.match(updatesBlock, /'updates_' \+ updateId \+ '_' \+ request\.auth\.uid/);
  assert.match(updatesBlock, /incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasOnly\(\['viewsCount'\]\)/);

  const usersBlock = rulesText.slice(
    rulesText.indexOf('match /users/{userId}'),
    rulesText.indexOf('match /privateUserData/{userId}')
  );
  assert.match(usersBlock, /affectedKeys\(\)\.hasOnly\(\['badge', 'isHiddenFromDirectory', 'accountStatus', 'followersCount', 'followingCount', 'updatedAt'\]\)/);

  assert.deepEqual(blueprint.entities.PostViewRecord.properties.targetCollection.enum, [
    'posts',
    'anonymousPosts',
    'updates',
  ]);
  assert.ok('visitorKey' in blueprint.entities.PostViewRecord.properties);
});

test('Official-Post-only polls, deduplicated votes, user WhatsApp/media toggles, and partial privateUserData rules extend without duplication', () => {
  // 1. No duplicate match blocks for core collections
  const countMatches = (pattern: RegExp) => (rulesText.match(pattern) ?? []).length;
  assert.equal(countMatches(/match \/users\/\{userId\}\s*\{/g), 1);
  assert.equal(countMatches(/match \/privateUserData\/\{userId\}\s*\{/g), 1);
  assert.equal(countMatches(/match \/updates\/\{updateId\}\s*\{/g), 1);
  assert.equal(countMatches(/match \/polls\/\{pollId\}\s*\{/g), 1);
  assert.equal(countMatches(/match \/votes\/\{voterUid\}\s*\{/g), 1);

  // 2. Narrow WhatsApp visibility & avatar/cover updates on users/{userId}
  const usersBlock = rulesText.slice(
    rulesText.indexOf('match /users/{userId}'),
    rulesText.indexOf('match /privateUserData/{userId}')
  );
  assert.match(usersBlock, /incoming\(\)\.showWhatsappPublicly is bool &&[\s\S]*affectedKeys\(\)\.hasOnly\(\['showWhatsappPublicly', 'updatedAt'\]\)/);
  assert.match(usersBlock, /affectedKeys\(\)\.hasOnly\(\[\s*'photoUrl', 'coverUrl', 'photoImageId', 'coverImageId', 'updatedAt'\s*\]\)/);

  // 3. Partial updates on privateUserData/{userId} preserve underground badge lock and legacy uid guard
  const privateBlock = rulesText.slice(
    rulesText.indexOf('match /privateUserData/{userId}'),
    rulesText.indexOf('match /anonymousHistory/{postId}')
  );
  assert.match(privateBlock, /!\('uid' in existing\(\)\) \|\| incoming\(\)\.uid == existing\(\)\.uid/);
  assert.match(privateBlock, /affectedKeys\(\)\.hasOnly\(\[\s*'notificationPrefs', 'interestCategories',\s*'ownedAnonymousPostIds', 'ownedAnonymousCommentIds',\s*'showSupremeAdminBadge', 'updatedAt'\s*\]\)/);

  // 4. Official Updates support optional pollId linked bidirectionally on create
  const updatesBlock = rulesText.slice(
    rulesText.indexOf('match /updates/{updateId}'),
    rulesText.indexOf('match /adminUpdateMappings/{updateId}')
  );
  assert.match(updatesBlock, /!\('pollId' in incoming\(\)\) \|\| \(\s*existsAfter\(\/databases\/\$\(database\)\/documents\/polls\/\$\(incoming\(\)\.pollId\)\) &&[\s\S]*updateId == updateId/);
  assert.match(updatesBlock, /'mediaItems', 'pollId', 'isPinned', 'status', 'updatedAt'/);

  // 5. Polls strictly bind to Official Updates, restrict CRUD to Supreme Admins, and guard voting + vote changes
  const pollsBlock = rulesText.slice(
    rulesText.indexOf('match /polls/{pollId}'),
    rulesText.indexOf('match /platformSettings/{settingId}')
  );
  assert.match(pollsBlock, /isZeroedCountsArray\(incoming\(\)\.optionCounts, incoming\(\)\.options\.size\(\)\)/);
  assert.match(pollsBlock, /incoming\(\)\.authorMode == 'official_desk' &&\s*!\('ownerUID' in incoming\(\)\)/);
  assert.match(pollsBlock, /getAfter\(\/databases\/\$\(database\)\/documents\/updates\/\$\(incoming\(\)\.updateId\)\)\.data\.pollId == pollId/);
  assert.match(pollsBlock, /existing\(\)\.status == 'open' &&\s*request\.time < existing\(\)\.expiresAt &&\s*isOfficialUpdatePublished\(existing\(\)\.updateId\) &&\s*isEligiblePollVoter\(existing\(\)\.voterScope\)/);
  assert.match(pollsBlock, /isValidPollCountsTransition\(/);
  assert.match(pollsBlock, /existing\(\)\.allowVoteChange == true/);

  const votesBlock = pollsBlock.slice(pollsBlock.indexOf('match /votes/{voterUid}'));
  assert.match(votesBlock, /allow get: if isValidId\(pollId\) && isValidId\(voterUid\) && \(\s*resource == null \|\|\s*isOwnerOf\(voterUid\) \|\|\s*isSupremeAdmin\(\)\s*\)/);
  assert.match(votesBlock, /allow list: if isValidId\(pollId\) && isSupremeAdmin\(\);/);
  assert.match(votesBlock, /!exists\(\/databases\/\$\(database\)\/documents\/polls\/\$\(pollId\)\/votes\/\$\(voterUid\)\)/);
  assert.match(votesBlock, /get\(\/databases\/\$\(database\)\/documents\/polls\/\$\(pollId\)\)\.data\.allowVoteChange == true/);
  assert.match(votesBlock, /allow delete: if isValidId\(pollId\) && isValidId\(voterUid\) && isSupremeAdmin\(\);/);

  // 6. Blueprint schema parity for CampusPoll, PollVoteRecord, and AdminUpdate.pollId
  assert.ok('pollId' in blueprint.entities.AdminUpdate.properties);
  assert.ok('updateId' in blueprint.entities.CampusPoll.properties);
  assert.ok('PollVoteRecord' in blueprint.entities);
  assert.ok('/polls/{pollId}/votes/{voterUid}' in blueprint.firestore);
});

test('firestore.rules has balanced braces, parentheses, brackets, and valid postViews match syntax', () => {
  const stack: string[] = [];
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const closing = new Set([')', '}', ']']);
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < rulesText.length; i++) {
    const ch = rulesText[i];
    const next = rulesText[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }

    if (ch in pairs) {
      stack.push(pairs[ch]);
    } else if (closing.has(ch)) {
      const expected = stack.pop();
      assert.equal(ch, expected, `Unexpected closing delimiter '${ch}' at index ${i}`);
    }
  }

  assert.equal(inSingle, false, 'Unclosed single-quoted string in firestore.rules');
  assert.equal(inDouble, false, 'Unclosed double-quoted string in firestore.rules');
  assert.equal(inBlockComment, false, 'Unclosed block comment in firestore.rules');
  assert.equal(stack.length, 0, `Unclosed delimiters remaining: ${stack.join(', ')}`);

  assert.match(
    rulesText,
    /\(!isSignedIn\(\) &&\s*incoming\(\)\.keys\(\)\.hasAll\(\['id', 'targetCollection', 'targetId', 'visitorKey', 'createdAt'\]\)/
  );
});

test('Self-profile saves support field-level users updates, privateUserData whatsapp/usernames sync, and legacy username reservations without exposing privilege escalation', () => {
  assert.match(rulesText, /function isValidUserProfileFieldPatch\(data, prev\)/);

  const fieldPatchBlock = rulesText.slice(
    rulesText.indexOf('function isValidUserProfileFieldPatch(data, prev)'),
    rulesText.indexOf('function isValidPrivateUser(data, userId)')
  );
  assert.match(fieldPatchBlock, /changed\.hasOnly\(\[/);
  assert.doesNotMatch(fieldPatchBlock, /'badge'|'accountStatus'|'isVerified'|'isHiddenFromDirectory'|'followersCount'|'followingCount'|'memberId'|'uid'/);
  assert.match(fieldPatchBlock, /!isReservedUsername\(data\.username\)/);
  assert.match(fieldPatchBlock, /getAfter\(\/databases\/\$\(database\)\/documents\/usernames\/\$\(data\.username\)\)\.data\.ownerUID == request\.auth\.uid/);

  const usersBlock = rulesText.slice(
    rulesText.indexOf('match /users/{userId}'),
    rulesText.indexOf('match /privateUserData/{userId}')
  );
  assert.match(usersBlock, /isValidUserProfileFieldPatch\(incoming\(\), existing\(\)\)/);

  const privateBlock = rulesText.slice(
    rulesText.indexOf('match /privateUserData/{userId}'),
    rulesText.indexOf('match /anonymousHistory/{postId}')
  );
  assert.match(privateBlock, /affectedKeys\(\)\.hasOnly\(\[\s*'whatsappNumber', 'phoneNumber', 'ownedUsernames', 'authEmail', 'updatedAt'\s*\]\)/);

  const usernamesBlock = rulesText.slice(
    rulesText.indexOf('match /usernames/{username}'),
    rulesText.indexOf('match /posts/{postId}')
  );
  assert.match(usernamesBlock, /!\('createdAt' in existing\(\)\) \|\| incoming\(\)\.createdAt == existing\(\)\.createdAt/);
  assert.match(usernamesBlock, /affectedKeys\(\)\.hasOnly\(\['isPrimary', 'redirectToUsername', 'updatedAt'\]\)/);
});

test('Self-profile field patch preserves unchanged usernames/Supreme Admin handles, privateUserData supports combined owner saves, and postViews enforces atomic increments', () => {
  const fieldPatchBlock = rulesText.slice(
    rulesText.indexOf('function isValidUserProfileFieldPatch(data, prev)'),
    rulesText.indexOf('function isValidPrivateUser(data, userId)')
  );
  assert.match(fieldPatchBlock, /\(\('username' in prev && data\.username == prev\.username\) \|\| isDesignatedSupremeAdminEmail\(\) \|\| !isReservedUsername\(data\.username\)\)/);
  assert.match(fieldPatchBlock, /'hasPublicActivity'/);

  const privateBlock = rulesText.slice(
    rulesText.indexOf('match /privateUserData/{userId}'),
    rulesText.indexOf('match /anonymousHistory/{postId}')
  );
  assert.match(
    privateBlock,
    /affectedKeys\(\)\.hasOnly\(\[\s*'whatsappNumber',\s*'phoneNumber',\s*'ownedUsernames',\s*'authEmail',\s*'notificationPrefs',\s*'interestCategories',\s*'ownedAnonymousPostIds',\s*'ownedAnonymousCommentIds',\s*'showSupremeAdminBadge',\s*'updatedAt'\s*\]\)/
  );

  const postViewsBlock = rulesText.slice(
    rulesText.indexOf('match /postViews/{viewId}'),
    rulesText.indexOf('match /marketplaceUpdates/{updateId}')
  );
  assert.match(postViewsBlock, /!exists\(\/databases\/\$\(database\)\/documents\/postViews\/\$\(viewId\)\)/);
  assert.match(postViewsBlock, /getAfter\(\/databases\/\$\(database\)\/documents\/posts\/\$\(incoming\(\)\.targetId\)\)\.data\.viewsCount/);
  assert.match(postViewsBlock, /getAfter\(\/databases\/\$\(database\)\/documents\/anonymousPosts\/\$\(incoming\(\)\.targetId\)\)\.data\.viewsCount/);
  assert.match(postViewsBlock, /getAfter\(\/databases\/\$\(database\)\/documents\/updates\/\$\(incoming\(\)\.targetId\)\)\.data\.viewsCount/);
});

test('Supreme Admins can save reserved usernames and profile/media edits even with legacy privacy/activity flags', () => {
  const usersBlock = rulesText.slice(
    rulesText.indexOf('match /users/{userId}'),
    rulesText.indexOf('match /privateUserData/{userId}')
  );
  assert.match(
    usersBlock,
    /!incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasAny\(\['hasPublicActivity'\]\)/
  );

  const privateBlock = rulesText.slice(
    rulesText.indexOf('match /privateUserData/{userId}'),
    rulesText.indexOf('match /anonymousHistory/{postId}')
  );
  assert.match(
    privateBlock,
    /!incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasAny\(\['showSupremeAdminBadge'\]\)/
  );

  const mediaBlock = rulesText.slice(
    rulesText.indexOf('match /mediaImages/{imageId}'),
    rulesText.indexOf('match /savedPosts/{savedId}')
  );
  assert.match(
    mediaBlock,
    /\(existing\(\)\.targetCollection in \['users_avatar', 'users_cover'\] && existing\(\)\.targetId == request\.auth\.uid\)/
  );
});

