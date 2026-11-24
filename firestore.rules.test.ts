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

test('all 26 blueprint collections have explicit rules in firestore.rules', () => {
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
  assert.match(rulesText, /data\[key\]\.size\(\) <= 4/);
  assert.match(rulesText, /data\.base64Data\.size\(\) <= 280000/);
  assert.match(rulesText, /data\.byteSize <= 250000/);
  assert.match(rulesText, /data\.targetCollection == 'anonymousPosts' && !\('ownerUID' in data\)/);
  assert.match(rulesText, /data\.mimeType in \['image\/webp', 'image\/jpeg'\]/);
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
    /\(isModerator\(\) && incoming\(\)\.eventType in \['marketplace_approved', 'marketplace_rejected'\]\)/
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
    /existing\(\)\.targetCollection == 'posts' && isModerator\(\) && \(!hasRoleDoc\(existing\(\)\.ownerUID\) \|\| roleDoc\(existing\(\)\.ownerUID\)\.role == 'member'\)/
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
    /function isActiveAccount\(uid\) \{\s*return !exists\(\/databases\/\$\(database\)\/documents\/users\/\$\(uid\)\) \|\|\s*!\('accountStatus' in get\(\/databases\/\$\(database\)\/documents\/users\/\$\(uid\)\)\.data\) \|\|\s*get\(\/databases\/\$\(database\)\/documents\/users\/\$\(uid\)\)\.data\.accountStatus == 'active';/
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
  assert.match(notifBlock, /incoming\(\)\.eventType == 'anonymous_reply'/);
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
    /\(isActiveSignedInUser\(\) &&\s*existing\(\)\.accountStatus == 'active' &&\s*incoming\(\)\.followersCount == existing\(\)\.followersCount \+ 1/
  );
  assert.match(
    usersBlock,
    /\(existing\(\)\.followersCount > 0 &&\s*incoming\(\)\.followersCount == existing\(\)\.followersCount - 1/
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
  assert.match(fnBlock, /data\.format in \['photo', 'text'\]/);
  assert.match(fnBlock, /data\.authorMode in \['public_admin', 'official_desk'\]/);
  assert.match(fnBlock, /!\('ownerUID' in data\)/);
  assert.match(fnBlock, /LASUED Intel Official/);
  assert.match(fnBlock, /isValidPhotoPostMediaItemsArray\(data\)/);
  assert.match(fnBlock, /isValidTextPostBackgroundStyle\(data\.backgroundStyle\)/);

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
