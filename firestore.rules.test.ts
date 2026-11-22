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

test('all 23 blueprint collections have explicit rules in firestore.rules', () => {
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
    'anonymousPosts',
    'anonymousComments',
    'anonymousIdentityMappings',
    'anonymousAuditLogs',
    'mediaImages',
    'savedPosts',
    'marketplaceListings',
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

  // Anonymous identity mappings forbid Moderator reads (only Supreme Admin or Owner)
  const mappingBlock = rulesText.slice(
    rulesText.indexOf('match /anonymousIdentityMappings/{entryId}'),
    rulesText.indexOf('match /anonymousAuditLogs/{auditId}')
  );
  assert.match(mappingBlock, /allow get: if isValidId\(entryId\) && isSupremeAdminOrOwner\(\);/);
  assert.match(mappingBlock, /allow list: if isSupremeAdminOrOwner\(\);/);

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

test('permanent owner shield, badge audit log immutability, role-badge sync, and marketplace no-double-approval rules are enforced', () => {
  assert.match(rulesText, /!isTargetPermanentOwner\(userId\)/);
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
    /allow get, list: if existing\(\)\.targetCollection == 'posts' \|\|/
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
  assert.match(adminLogBlock, /allow get, list: if isSupremeAdminOrOwner\(\);/);
  assert.match(adminLogBlock, /allow update, delete: if false;/);
  assert.match(
    adminLogBlock,
    /isModerator\(\) && incoming\(\)\.action in \[\s*'marketplace_approved', 'marketplace_rejected',\s*'post_deleted', 'anonymous_post_deleted',\s*'post_comment_deleted', 'anonymous_comment_deleted'\s*\]/
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
  assert.match(settingsBlock, /allow delete: if isPermanentOwner\(\)/);
});

