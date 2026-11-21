# LASUED Intel — Product & Firebase Backend Architecture

## 1. Existing Frontend Foundation Preserved
- **Root Entry**: `index.html` and `lasued-intel.webp` remain at the project root. All logo references use `./lasued-intel.webp`.
- **Vite Asset Handling**: `vite.config.ts` copies root `lasued-intel.webp` into `dist/lasued-intel.webp` during production builds without duplicating or moving the source file.
- **Brand Identity (`src/config/brand.ts`)**: Navy `#0B1A2E`, Bright Blue `#1E88E5`, White `#FFFFFF`, Tagline `"Your Campus. Your Information. Your Community."`.

## 2. Role & Badge Permission Matrix

| Capability | Visitor | Member | Verified (Green) | Moderator (Red) | Supreme Admin (Purple) | Permanent Owner |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| Browse public feeds, marketplace, trusted contacts, opportunities, events | Yes | Yes | Yes | Yes | Yes | Yes |
| Like, comment, reply, follow, save posts | No | Yes | Yes | Yes | Yes | Yes |
| Publish anonymous posts & replies (`The Unfiltered`) | No | Yes | Yes | Yes | Yes | Yes |
| Publish ordinary community feed updates (`posts`) | No | No | Yes | Yes | Yes | Yes |
| Pin official updates / manage `opportunities` & `events` | No | No | No | No | Yes | Yes |
| Submit marketplace listings | No | Pending | Auto-Active | Auto-Active | Auto-Active | Auto-Active |
| Approve pending member marketplace listings | No | No | No | Yes | Yes | Yes |
| Delete ordinary members' posts / comments / anonymous posts | No | Own only | Own only | Yes | Yes | Yes |
| Delete/moderate Verified or Moderator content (incl. anonymous) | No | No | No | **No** | Yes | Yes |
| Reveal anonymous author identity & view `anonymousAuditLogs` | No | No | No | **No** | Yes | Yes |
| Grant/revoke Verified & Moderator badges | No | No | No | No | Yes | Yes |
| Manage Customer Supreme Admin or protect/alter Owner | No | No | No | No | **Cannot alter Owner** | Yes |

## 3. Firestore Collection Architecture (`firebase-blueprint.json`)
- **`users/{userId}`**: Public member profile (`uid`, `memberId`, `fullName`, `username`, `department`, `level`, `badge`, `isHiddenFromDirectory`, `showWhatsappPublicly`). No private email or unconsented phone number.
- **`privateUserData/{userId}`**: Strictly owner-only private PII (`authEmail`, `phoneNumber`, `whatsappNumber`, `notificationPrefs`, `interestCategories`).
- **`userRoles/{userId}`**: Database-enforced role and badge authority (`role`, `badge`, `isPermanentOwner`, `isHiddenFromDirectory`). Cannot be self-written or escalated by clients.
- **`usernames/{username}`**: Lowercase unique username lock mapped 1:1 to `ownerUID`.
- **`posts/{postId}` & `postComments/{commentId}`**: Ordinary community updates (For You, Following, Latest).
- **`follows/{followId}` & `postReactions/{reactionId}` & `savedPosts/{savedId}`**: Public follows, reactions, and private bookmarks.
- **`anonymousPosts/{postId}` & `anonymousComments/{commentId}`**: Public anonymous feed (`The Unfiltered`) containing **zero** author UID, email, phone, or profile identifiers.
- **`anonymousIdentityMappings/{entryId}` & `anonymousAuditLogs/{auditId}`**: Strictly isolated identity mapping (`authorUid`, `authorRole`) and reveal audit log, readable only by Supreme Admin / Owner. `firestore.rules` performs server-side `get()` checks against `anonymousIdentityMappings` during `allow delete` on `anonymousPosts` and `anonymousComments` so Moderators are blocked from deleting Verified/Moderator anonymous posts without ever seeing their identity.
- **`marketplaceListings/{listingId}`**: Products, services, and accommodation with `approvalStatus`, `status`, `quantity`, and 7-day `expiresAt` timestamp. No payment or banking fields.
- **`trustedContacts/{contactId}`**: Administrator-listed lecturer and student rep directory entries (`entryType: 'admin_listed_contact'`, `isUserAccount: false`).
- **`opportunities/{opportunityId}`, `events/{eventId}`, `notifications/{notificationId}`, `polls/{pollId}`, `platformSettings/{settingId}`**.

## 4. Trusted Server-Side Admin SDK & Starter Tier Constraints
- The provisioned Firebase project (`mystical-tooling-2dtd0`) is a **Google-hosted Starter Tier project** (free tier, no paid billing enabled).
- Per Google Cloud Starter Tier rules, server-side `firebase-admin` operations requiring project IAM (minting custom claims via `setCustomUserClaims()`, server-side Firestore bypass, or token revocation checks) are **not available** on Starter Tier projects because the AI Studio server service account cannot be granted IAM roles on Starter Tier projects.
- **How security is enforced today**: All RBAC, owner protection, PII isolation, anonymous identity isolation, and Moderator conflict enforcement are enforced directly in **Cloud Firestore Security Rules (`firestore.rules`)** using verified Auth identity (`request.auth.token.email_verified == true`) and protected `/userRoles/{uid}` lookups.
- **How server-side Admin SDK & Cascade Deletes work when upgraded**: A clean server-side interface blueprint is prepared in `src/lib/adminArchitecture.ts` (and documented for Cloud Functions / Node Admin SDK once you upgrade to a user-owned Blaze project or attach IAM to a project you own) for:
  1. Custom claims synchronization (`role`, `badge`, `isPermanentOwner`).
  2. Cascading deletion of `anonymousPosts` + `anonymousComments` + `postReactions` + `anonymousIdentityMappings`.
  3. Audited Supreme Admin anonymous identity reveals writing atomically to `anonymousAuditLogs`.
  4. Scheduled or background recommendation scoring (`For You`) and marketplace expiry sweeps.

## 5. Manual Actions Required in Firebase Console
1. **Enable Email/Password Sign-In**: Google Sign-In is configured automatically during provisioning. To enable Email & Password login/registration, open the Firebase Console -> **Authentication** -> **Sign-in method** -> enable **Email/Password**.
2. **Permanent Owner Bootstrap**: Sign in once with the permanent owner Google/Email account (`estheriawoyinfa52@gmail.com`). That verified email is bootstrapped in `firestore.rules` with Owner authority so you can create your `/userRoles/{uid}` document (`role: 'owner'`, `isPermanentOwner: true`, `isHiddenFromDirectory: true`) and appoint the Customer Supreme Admin once their real email/UID is ready.
3. **Optional Upgrade for Firebase Admin SDK**: Only if you later choose to enable Cloud Functions / Admin SDK IAM operations (such as custom claims or cascading server deletes), upgrade the project to a user-owned standard Google Cloud project with billing.
