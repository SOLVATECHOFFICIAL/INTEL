# LASUED Intel — Security Rules Specification & Red-Team TDD

## 1. Core Data Invariants
1. **Default Deny**: No collection or path is readable or writable unless explicitly permitted.
2. **Strict Two-Admin Lock**: Administrative governance is permanently locked in `firestore.rules` to strictly two verified Firebase Authentication emails (`request.auth.token.email.trim().lower()` with `email_verified == true`):
   - Public Supreme Admin (`lasuedintel@gmail.com`): public `supreme_admin` badge visible, directory visible, full governance and anonymous reveal permissions.
   - Underground Supreme Admin (`awoyinfasolomon1@gmail.com`): full Supreme Admin governance and anonymous reveal permissions, permanently hidden (`isHiddenFromDirectory == true`, public `badge == 'none'`, `showSupremeAdminBadge == false`).
   - Legacy `'owner'` / `isPermanentOwner` privileges are completely removed; any stale `userRoles` record with `role == 'owner'` or `isPermanentOwner == true` grants zero elevated permissions.
3. **Peer & Underground Admin Shield**: Neither Supreme Admin may modify, demote, suspend, or delete the other Supreme Admin's profile or `userRoles` record, nor delete their own designated admin profile/private account doc.
4. **PII Isolation**: Private contact details, auth emails, notification preferences, and `pushSubscriptions` live in `privateUserData/{userId}` and are strictly unreadable/unwritable by non-owners.
5. **Anonymous Identity Separation**: `anonymousPosts` and `anonymousComments` MUST NOT contain `ownerUID`, `authorUid`, `email`, `phone`, or any direct identity field. Identity links live exclusively in `anonymousIdentityMappings/{entryId}`, readable ONLY by the two designated Supreme Admin accounts.
6. **Anonymous Moderator Conflict Rule**: Moderators cannot read `anonymousIdentityMappings`, yet `firestore.rules` looks up `anonymousIdentityMappings/$(postId)` server-side inside `allow delete` to block Moderators from deleting anonymous content authored by Verified, Moderator, or Supreme Admin accounts.
7. **Marketplace Integrity**: Ordinary members submit with `status == 'pending_approval'`; double approval (`approved -> approved`) is blocked; no payment or bank account fields exist.
8. **Temporal & Schema Integrity**: Creation timestamps must equal `request.time`; update timestamps must equal `request.time`; immutable owner/createdAt fields cannot change; all strings have strict `.size()` bounds.

## 2. Adversarial Security Invariants
1. **Self-Escalation on Signup**: Member creates `/userRoles/{myUid}` with `{ role: "supreme_admin", badge: "supreme_admin" }` -> **MUST DENY**.
2. **Legacy Owner Spoof**: User with stale `/userRoles/{uid}` containing `{ role: "owner", isPermanentOwner: true }` attempts admin write -> **MUST DENY**.
3. **Underground Badge Leakage**: Underground Supreme Admin attempts to set public `/users/{uid}.badge` to `"supreme_admin"` or `showSupremeAdminBadge: true` -> **MUST DENY**.
4. **Email Verification Spoof**: Unverified user (`email_verified: false`) with matching admin email attempts admin write -> **MUST DENY**.
5. **Cross-User PII Read**: Authenticated user reads `/privateUserData/{otherUid}` or `/privateUserData/{otherUid}/pushSubscriptions/{subId}` -> **MUST DENY**.
6. **Ordinary Member Feed Publish**: Ordinary `member` creates `/posts/{postId}` -> **MUST DENY**.
7. **Anonymous Identity Injection**: Member creates `/anonymousPosts/{postId}` with extra key `ownerUID: "abc"` -> **MUST DENY**.
8. **Moderator Reading Anonymous Identity**: `moderator` issues `get` or `list` on `/anonymousIdentityMappings/{entryId}` -> **MUST DENY**.
9. **Moderator Deleting Verified User's Post**: `moderator` deletes `/posts/{verifiedPostId}` where `authorRole == "verified"` -> **MUST DENY**.
10. **Moderator Deleting Verified User's Anonymous Post**: `moderator` deletes `/anonymousPosts/{anonId}` where `anonymousIdentityMappings/{anonId}.authorRole == "verified"` -> **MUST DENY**.
11. **Marketplace Double Approval**: `moderator` approves `/marketplaceListings/{id}` when `existing().approvalStatus == "approved"` -> **MUST DENY**.
12. **Base64 Image Size & Separation**: Client attempts to embed raw Base64 inside `/posts/{id}` or upload `base64Data` > 280,000 chars into `/mediaImages/{imageId}` -> **MUST DENY**.
13. **Anonymous Image Identity Leakage**: Client creates `/mediaImages/{imageId}` for `targetCollection: "anonymousPosts"` with an `ownerUID` field -> **MUST DENY**.
14. **Admin Audit Log Immutability**: Supreme Admin attempts to update or delete an entry in `/adminAuditLogs/{logId}` -> **MUST DENY**.

## 3. Governance & Audit Invariants
1. **`/adminAuditLogs/{logId}`**: Immutable administrative & moderation log readable exclusively by the two designated Supreme Admins. Moderators may append strictly scoped marketplace decision (`marketplace_approved`, `marketplace_rejected`) and ordinary-member content deletion entries matching their own UID and role.
2. **Collaborative Supreme Admin Management**: `trustedContacts`, `opportunities`, and `events` preserve immutable initial creator (`createdByUid` / `ownerUID`) on `update` so either designated Supreme Admin can manage records created by the other.
3. **Platform Settings (`/platformSettings/{settingId}`)**: Readable by `get` so notice/policy flags apply across clients; writable and deletable strictly by designated Supreme Admins.

## 4. Ordinary Feed & Format Separation Invariants
1. **Deny-by-Default Posting Permissions (`canPublishFeed()`)**: Creating or editing ordinary community posts requires either designated verified Supreme Admin status or an active `users/{uid}` document + consistent `userRoles/{uid}` document (`verified` or `moderator`) with matching `users/{uid}.badge == userRoles/{uid}.badge`.
2. **Strict Separation Between `text` and `photo` Ordinary Posts (`isValidTypedCommunityPost()`)**:
   - `postType == 'text'`: requires one of the 8 coloured/gradient `backgroundStyle` values, `1..500` character body, and zero photo attachments.
   - `postType == 'photo'`: forbids `backgroundStyle`, requires `1..4` `mediaItems` with zero per-photo `caption` strings, and allows one shared caption (`0..2000` chars).
   - `postType` is immutable after creation.
3. **Target Post Integrity on Reactions & Comments**: `postReactions` and `postComments` creation verify that the target item exists and is published/active.

## 5. Notifications, Mentions & Anonymous Reply Safety
1. **Atomic Follow Notification Guard**: Authenticated active users may create `'follow'` notifications ONLY inside an atomic transaction transitioning `follows/{actorUid}_{targetUid}` from non-existent (`!exists`) to existing (`existsAfter`).
2. **Activity & Mention Spoof Protection**: Creating `'reaction'`, `'comment'`, `'reply'`, or `'mention'` notifications requires `actorUid == request.auth.uid`, `recipientUid != request.auth.uid`, and verification that `users/{recipientUid}` exists.
3. **Zero-Identity Anonymous Reply Notifications**: Creating `'anonymous_reply'` notifications is allowed only for the recipient's own signed-in account (`recipientUid == request.auth.uid`) with `actorUid`, `actorUsername`, `actorName`, `actorPhotoUrl`, and `actorPhotoImageId` strictly absent.
4. **Marketplace Listing Q&A**: `/postComments` supports `targetCollection == 'marketplaceListings'` strictly when the target listing is `'active'`.

## 6. Official Administrator Updates (`/updates` & `/adminUpdateMappings`)
1. **Strict Two-Admin Publishing Lock**: Only `lasuedintel@gmail.com` and `awoyinfasolomon1@gmail.com` (`isSupremeAdmin()`) can create, edit, pin, or delete documents in `/updates/{updateId}`.
2. **Underground Identity Isolation (`official_desk`)**: Updates authored by `awoyinfasolomon1@gmail.com` MUST use `authorMode == 'official_desk'`, `authorDisplayName == 'LASUED Intel Official'`, `authorBadge == 'verified'`, and MUST OMIT `ownerUID` from `/updates/{updateId}`, `/mediaImages/{imageId}`, and `/notifications/{notificationId}`.
3. **Isolated Mapping**: Real creator authorship is stored only inside `/adminUpdateMappings/{updateId}`, readable exclusively by `isSupremeAdmin()`.
4. **Format Separation**: `format == 'text'` forbids `mediaItems` and requires a valid `backgroundStyle` (`1..500` chars); `format == 'photo'` forbids `backgroundStyle` and requires `1..4` compressed `mediaItems`.
5. **Engagement Counters**: Reactions (`updates_{updateId}_{uid}`) and comments (`targetCollection == 'updates'`) use atomic Firestore security rule transitions matching `/posts` and `/events`.

## 7. Rebuild Hardening, Cascade Cleanup & Index Coverage
1. **Designated Supreme Admin Self-Sync (`users/{userId}`)**: Allows `lasuedintel@gmail.com` and `awoyinfasolomon1@gmail.com` to restore only `['badge', 'isHiddenFromDirectory', 'updatedAt']` on their own profile document (`ensureDesignatedSupremeAdminAccountState`) while enforcing `isUndergroundSupremeAdminEmail()` badge (`none`) and hidden-directory invariants.
2. **Media & Poll Element Bounds**: `isValidMediaArray` validates every index `0..5`; `isValidCampusPoll` validates every option `0..7`; `badgeAuditLogs` requires `isActiveSignedInUser()`; `mediaImages` Moderator deletes guard `'ownerUID' in existing() && isValidId(existing().ownerUID)`.
3. **Admin Update Field Locks & State Consistency**: `trustedContacts`, `opportunities`, `events`, `polls`, `platformSettings`, and `marketplaceUpdates` enforce `id`/`createdAt`/owner immutability and explicit `affectedKeys().hasOnly(...)` whitelists; `marketplaceListings` approval strictly enforces `approved -> (active, public)` and `rejected -> (rejected, owner_and_admins)` with an 8-day `expiresAt` cap; Moderator marketplace notifications enforce `recipientUid != request.auth.uid` and caller `actorUid`.
4. **Chunked Post Deletion & Orphaned Reactions**: `deletePostCascading` groups primary cleanup documents + parent deletion into Batch 0 (<= 380 writes) and flushes remaining `postReactions` in follow-up batches (`380` ops each); `postReactions` `allow delete` supports both atomic `!existsAfter(parent)` and post-delete `!exists(parent)` across all 6 target collections.
5. **Composite Index Coverage (`firestore.indexes.json`)**: Includes `(ownerUID, status)` on `marketplaceListings`, `(recipientUid, isRead)` on `notifications`, and `(ownerUID, targetId)` + `(ownerUID, targetCollection, targetId)` on `savedPosts`.

