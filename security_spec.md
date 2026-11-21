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
11. **Marketplace Double Approval**: `moderator` approves `/marketplaceListings/{id}` when `existing().approvalStatus == "approved"` -> **MUST DENY**.
12. **Resource Poisoning via Oversized ID / String**: Authenticated user attempts write to `/posts/{150-char-invalid-id}` or 20KB `body` -> **MUST DENY**.
