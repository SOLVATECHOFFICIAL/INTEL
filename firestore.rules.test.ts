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

test('all 20 blueprint collections have explicit rules in firestore.rules', () => {
  const expectedCollections = [
    'users',
    'privateUserData',
    'userRoles',
    'usernames',
    'posts',
    'postComments',
    'follows',
    'postReactions',
    'anonymousPosts',
    'anonymousComments',
    'anonymousIdentityMappings',
    'anonymousAuditLogs',
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
      Object.prototype.hasOwnProperty.call(blueprint.firestore, `/${name}/${name === 'usernames' ? '{username}' : name === 'users' || name === 'privateUserData' || name === 'userRoles' ? '{userId}' : ''}`.replace(/\/$/, '')) ||
        Object.keys(blueprint.firestore).some((key) => key.startsWith(`/${name}/`)),
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

  // Moderator deletion on anonymousPosts & anonymousComments enforces authorRole == 'member'
  assert.match(
    rulesText,
    /isModerator\(\) && get\(\/databases\/\$\(database\)\/documents\/anonymousIdentityMappings\/\$\(postId\)\)\.data\.authorRole == 'member'/
  );
  assert.match(
    rulesText,
    /isModerator\(\) && get\(\/databases\/\$\(database\)\/documents\/anonymousIdentityMappings\/\$\(commentId\)\)\.data\.authorRole == 'member'/
  );
});

test('permanent owner shield and marketplace no-double-approval rules are enforced', () => {
  assert.match(rulesText, /!isTargetPermanentOwner\(userId\)/);
  assert.match(rulesText, /existing\(\)\.approvalStatus == 'pending_approval'/);
  assert.match(rulesText, /data\.entryType == 'admin_listed_contact'/);
  assert.match(rulesText, /data\.isUserAccount == false/);
});

test('Prompt 4 username uniqueness, reserved names, follow determinism, and atomic counters are enforced', () => {
  assert.match(rulesText, /function isReservedUsername\(username\)/);
  assert.match(rulesText, /!isReservedUsername\(data\.username\)/);
  assert.match(rulesText, /followId == request\.auth\.uid \+ '_' \+ incoming\(\)\.targetUid/);
  assert.match(rulesText, /incoming\(\)\.targetUid != request\.auth\.uid/);
  assert.match(rulesText, /existsAfter\(\/databases\/\$\(database\)\/documents\/follows\/\$\(request\.auth\.uid \+ '_' \+ userId\)\)/);
  assert.match(rulesText, /existing\(\)\.ownerUID == request\.auth\.uid/);
});
