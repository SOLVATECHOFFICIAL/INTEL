# LASUED Intel — Security Rules Specification & Red-Team TDD

## 1. Core Data Invariants
1. **Default Deny**: No collection or path is readable or writable unless explicitly permitted.
2. **Role & Badge Integrity**: No user may set or alter their own `role`, `badge`, or `isPermanentOwner`. Only Supreme Admin / Owner may manage Verified or Moderator badges, and only the Permanent Owner may modify or demote a Supreme Admin or protect against Owner removal.
3. **Permanent Owner Protection**: Any `userRoles/{uid}` document with `isPermanentOwner == true` or `role == 'owner'` cannot be overwritten, demoted, or deleted by any other user, including Customer Supreme Admins.
4. **PII Isolation**: Private contact details, auth emails, and notification preferences live in `privateUserData/{userId}` and are strictly unreadable/unwritable by non-owners.
5. **Anonymous Identity Separation**: `anonymousPosts` and `anonymousComments` MUST NOT contain `ownerUID`, `authorUid`, `email`, `phone`, or any direct identity field. Identity links live exclusively in `anonymousIdentityMappings/{entryId}`, readable ONLY by Supreme Admin / Owner.
6. **Anonymous Moderator Conflict Rule**: Moderators cannot read `anonymousIdentityMappings`, yet `firestore.rules` looks up `anonymousIdentityMappings/$(postId)` server-side inside `allow delete` to block Moderators from deleting anonymous content authored by Verified, Moderator, Supreme Admin, or Owner accounts.
7. **Marketplace Integrity**: Ordinary members submit with `status == 'pending_approval'`; double approval (`approved -> approved`) is blocked; no payment or bank account fields exist.
8. **Temporal & Schema Integrity**: Creation timestamps must equal `request.time`; update timestamps must equal `request.time`; immutable owner/createdAt fields cannot change; all strings have strict `.size()` bounds.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Self-Escalation on Signup**: Member creates `/userRoles/{myUid}` with `{ role: "supreme_admin", badge: "supreme_admin" }` -> **MUST DENY**.
2. **Badge Tampering on Profile**: Member updates `/users/{myUid}` changing `badge` from `"none"` to `"verified"` -> **MUST DENY**.
3. **Owner Demotion by Supreme Admin**: Customer Supreme Admin updates `/userRoles/{ownerUid}` to `{ role: "member" }` -> **MUST DENY**.
4. **Email Verification Spoof**: Unverified user (`email_verified: false`) with matching owner email attempts admin write -> **MUST DENY**.
5. **Cross-User PII Read**: Authenticated user reads `/privateUserData/{otherUid}` -> **MUST DENY**.
6. **Ordinary Member Feed Publish**: Ordinary `member` creates `/posts/{postId}` -> **MUST DENY**.
7. **Anonymous Identity Injection**: Member creates `/anonymousPosts/{postId}` with extra key `ownerUID: "abc"` -> **MUST DENY**.
8. **Moderator Reading Anonymous Identity**: `moderator` issues `get` or `list` on `/anonymousIdentityMappings/{entryId}` -> **MUST DENY**.
9. **Moderator Deleting Verified User's Post**: `moderator` deletes `/posts/{verifiedPostId}` where `authorRole == "verified"` -> **MUST DENY**.
10. **Moderator Deleting Verified User's Anonymous Post**: `moderator` deletes `/anonymousPosts/{anonId}` where `anonymousIdentityMappings/{anonId}.authorRole == "verified"` -> **MUST DENY**.
10. **Marketplace Double Approval**: `moderator` approves `/marketplaceListings/{id}` when `existing().approvalStatus == "approved"` -> **MUST DENY**.
11. **Base64 Image Size & Separation**: Client attempts to embed raw Base64 inside `/posts/{id}` or upload `base64Data` > 280,000 chars into `/mediaImages/{imageId}` -> **MUST DENY**.
12. **Anonymous Image Identity Leakage**: Client creates `/mediaImages/{imageId}` for `targetCollection: "anonymousPosts"` with an `ownerUID` field, or non-author/unauthorized user deletes another user's `mediaImages` doc -> **MUST DENY**.
13. **Moderator Scope Containment**: Moderator attempts to read `adminAuditLogs`, create `badgeAuditLogs`, delete `marketplaceListings`, moderate a Verified member's marketplace listing, or toggle `isPinned`/`isOfficial` on `/posts/{postId}` -> **MUST DENY**.
14. **Admin Audit Log Immutability**: Supreme Admin attempts to update or delete an entry in `/adminAuditLogs/{logId}` -> **MUST DENY**.

## 3. Prompt 6 Governance Additions
1. **`/adminAuditLogs/{logId}`**: Immutable administrative & moderation log readable exclusively by Supreme Admin / Permanent Owner. Moderators may append strictly scoped marketplace decision (`marketplace_approved`, `marketplace_rejected`) and ordinary-member content deletion (`post_deleted`, `anonymous_post_deleted`, `post_comment_deleted`, `anonymous_comment_deleted`) entries matching their own UID and role.
2. **Collaborative Supreme Admin Management**: `trustedContacts`, `opportunities`, and `events` preserve immutable initial creator (`createdByUid` / `ownerUID`) on `update` so any authorised Supreme Admin or Permanent Owner can edit or manage records created by another authorised Supreme Admin.
3. **Platform Settings (`/platformSettings/{settingId}`)**: Readable by `get` so notice/policy flags apply cleanly across clients; writable strictly by Supreme Admin or Permanent Owner; deletable strictly by Permanent Owner.

## 4. Prompt 7 Ordinary Feed & Format Separation Invariants
1. **Deny-by-Default Posting Permissions (`canPublishFeed()`)**: Creating or editing ordinary community posts requires an active `users/{uid}` document, an active consistent `userRoles/{uid}` document (`verified`, `moderator`, `supreme_admin`, or `owner`), and matching `users/{uid}.badge == userRoles/{uid}.badge` (plus verified email for Permanent Owner). Missing or mismatched role/badge data denies ordinary posting by default.
2. **Strict Separation Between `text` and `photo` Ordinary Posts (`isValidTypedCommunityPost()`)**:
   - `postType == 'text'`: requires one of the 8 coloured/gradient `backgroundStyle` values (`navy_slate`, `ocean_blue`, `cobalt_indigo`, `midnight_emerald`, `sunset_amber`, `crimson_rose`, `royal_plum`, `warm_charcoal`), `1..500` character body, and zero photo attachments (`mediaItems` / `mediaUrls`).
   - `postType == 'photo'`: forbids `backgroundStyle`, requires `1..4` `mediaItems` with zero per-photo `caption` strings, and allows one shared caption (`0..2000` chars) displayed above the photo grid.
   - `postType` is immutable after creation.
3. **Target Post Integrity on Reactions & Comments**: `postReactions` and `postComments` creation verify that the target post exists and has `status == 'published'`, while deterministic reaction IDs (`posts_{postId}_{uid}`) prevent duplicate likes per account.

