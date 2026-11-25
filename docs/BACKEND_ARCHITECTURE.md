# LASUED Intel — Product & Firebase Backend Architecture

## 1. Existing Frontend Foundation Preserved
- **Root Entry**: `index.html` and `lasued-intel.webp` remain at the project root. All logo references use `./lasued-intel.webp`.
- **Vite Asset Handling**: `vite.config.ts` copies root `lasued-intel.webp` into `dist/lasued-intel.webp` during production builds without duplicating or moving the source file.
- **Brand Identity (`src/config/brand.ts`)**: Navy `#0B1A2E`, Bright Blue `#1E88E5`, White `#FFFFFF`, Tagline `"Your Campus. Your Information. Your Community."`.

## 2. Role & Badge Permission Matrix (Strict Two-Admin Architecture)

| Capability | Visitor | Member | Verified (Green) | Moderator (Red) | Underground Supreme Admin | Public Supreme Admin (Purple) |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| Public directory & badge visibility | — | Public | Public (`verified`) | Public (`moderator`) | **Hidden (`none`)** | Public (`supreme_admin`) |
| Browse public feeds, marketplace, trusted contacts, opportunities, events | Yes | Yes | Yes | Yes | Yes | Yes |
| Like, comment, reply, mention, follow, save posts | No | Yes | Yes | Yes | Yes | Yes |
| Publish anonymous posts & replies (`The Unfiltered`) | No | Yes | Yes | Yes | Yes | Yes |
| Publish ordinary community feed updates (`posts`) | No | No | Yes | Yes | Yes | Yes |
| Pin official updates / manage `opportunities` & `events` | No | No | No | No | Yes | Yes |
| Submit marketplace listings | No | Pending | Auto-Active | Auto-Active | Auto-Active | Auto-Active |
| Approve pending member marketplace listings | No | No | No | Yes | Yes | Yes |
| Delete ordinary members' posts / comments / anonymous posts | No | Own only | Own only | Yes | Yes | Yes |
| Delete/moderate Verified or Moderator content (incl. anonymous) | No | No | No | **No** | Yes | Yes |
| Reveal anonymous author identity & view `anonymousAuditLogs` | No | No | No | **No** | Yes | Yes |
| Grant/revoke Verified & Moderator badges | No | No | No | No | Yes | Yes |
| Modify or demote peer Supreme Admin | No | No | No | No | **No** | **No** |

## 3. Firestore Collection Architecture (`firebase-blueprint.json`)
- **`users/{userId}`**: Public member profile (`uid`, `memberId`, `fullName`, `username`, `department`, `level`, `badge`, `isHiddenFromDirectory`, `showWhatsappPublicly`). No private email or unconsented phone number.
- **`privateUserData/{userId}`**: Strictly owner-only private PII (`authEmail`, `phoneNumber`, `whatsappNumber`, `notificationPrefs`, `interestCategories`), plus subcollections `anonymousHistory/{postId}` and `pushSubscriptions/{subId}`.
- **`userRoles/{userId}`**: Database-enforced role and badge authority (`role`, `badge`, `isPermanentOwner: false`, `isHiddenFromDirectory`). Cannot be self-written or escalated by clients; `supreme_admin` is restricted solely to `lasuedintel@gmail.com` and `awoyinfasolomon1@gmail.com`.
- **`usernames/{username}`**: Lowercase unique username lock mapped 1:1 to `ownerUID`.
- **`posts/{postId}` & `postComments/{commentId}`**: Ordinary community updates (For You, Following, Latest) plus comments/replies on posts, events, and active marketplace listings.
- **`follows/{followId}` & `postReactions/{reactionId}` & `savedPosts/{savedId}`**: Public follows, reactions, and private bookmarks.
- **`anonymousPosts/{postId}` & `anonymousComments/{commentId}`**: Public anonymous feed (`The Unfiltered`) containing **zero** author UID, email, phone, or profile identifiers.
- **`anonymousIdentityMappings/{entryId}` & `anonymousAuditLogs/{auditId}`**: Strictly isolated identity mapping (`authorUid`, `authorRole`) and reveal audit log, readable only by the two designated Supreme Admins. `firestore.rules` performs server-side `get()` checks against `anonymousIdentityMappings` during `allow delete` on `anonymousPosts` and `anonymousComments` so Moderators are blocked from deleting Verified/Moderator anonymous posts without ever seeing their identity.
- **`marketplaceListings/{listingId}`**: Products, services, and accommodation with `approvalStatus`, `status`, `quantity`, and 7-day `expiresAt` timestamp. No payment or banking fields.
- **`trustedContacts/{contactId}`**: Administrator-listed lecturer and student rep directory entries (`entryType: 'admin_listed_contact'`, `isUserAccount: false`).
- **`opportunities/{opportunityId}`, `events/{eventId}`, `notifications/{notificationId}`, `polls/{pollId}`, `platformSettings/{settingId}`, `_serverPushDedup/{dedupId}`**.

## 4. Web Push & Serverless API Architecture (`/api/push/*`)
- **PWA + Web Push Service Worker (`src/sw.ts`)**: Compiled via VitePWA `injectManifest`, supporting offline caching plus background `push` and `notificationclick` deep linking without conflicting with the PWA lifecycle.
- **`/api/push/config`**: Returns sanitized Web Push readiness (`configured`, `vapidPublicKey`) without exposing secrets.
- **`/api/push/dispatch`**: Verifies Firebase Auth ID token (`checkRevoked: true`) or timing-safe `x-push-webhook-secret`, enforces caller authorization and notification preference checks, deduplicates via `_serverPushDedup`, delivers via `web-push`, and auto-prunes expired `404`/`410` subscriptions.
- **`/api/push/broadcast`**: Verifies designated Supreme Admin status (`lasuedintel@gmail.com` or `awoyinfasolomon1@gmail.com` with `email_verified: true`) or `x-push-webhook-secret` before broadcasting campus events, opportunities, or announcements across subscribed devices.

## 5. Production Configuration Checklist
1. **Firebase Authentication**: Confirm Email/Password sign-in is enabled and `lasuedintel.com.ng` (plus `www.lasuedintel.com.ng` and any Vercel preview/production domain) is listed under Authorized Domains in Firebase Console.
2. **Firestore Rules & Indexes**: Deploy `firestore.rules` and `firestore.indexes.json` to project `lasued-intel` (database `(default)`).
3. **Two Designated Supreme Admins**: Only `lasuedintel@gmail.com` (Public Supreme Admin) and `awoyinfasolomon1@gmail.com` (Underground Supreme Admin, hidden from directory with `badge: 'none'`) carry Supreme Admin authority.
