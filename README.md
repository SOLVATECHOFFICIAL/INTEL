# LASUED Intel

**LASUED Intel** — *Your Campus. Your Information. Your Community.*  
Production web application for Lagos State University of Education (LASUED) campus updates, community posts, **The Unfiltered** anonymous discussions, student marketplace, Trusted Circle directory, student opportunities, and campus events.

- **Production URL**: `https://lasuedintel.com.ng`
- **Hosting**: Vercel (SPA + Serverless API functions under `/api/*`)
- **DNS Registrar**: WhoGoHost
- **Backend**: Firebase (`lasued-intel` — Firestore `(default)` database + Firebase Authentication)
- **Frontend Stack**: React 19, Vite 8, TypeScript, Tailwind CSS v4, VitePWA, D3

---

## 1. Local Development & Testing

### Prerequisites
- Node.js 20+ (with `npm`)
- Firebase CLI (`npm i -g firebase-tools`) for deploying Firestore rules/indexes
- Optional: Java 17+ if running `firestore.emulator.test.ts` against the local Firebase Emulator

### Install & Run

```bash
npm install
npm run dev
```

The development server runs on `http://localhost:3000`.

### Build, Lint & Unit Tests

```bash
# Type-check and build production bundle into dist/
npm run build

# Run ESLint across app code and firestore.rules
npm run lint

# Run all unit, SEO, PWA, push API, and rules contract tests
npx --yes tsx --test api/push/pushApi.test.ts firestore.rules.test.ts src/config/*.test.ts src/types/*.test.ts src/utils/*.test.ts

# Optional (requires Java + Firebase Emulator):
npx --yes firebase emulators:exec --only firestore "npx --yes tsx --test firestore.emulator.test.ts"
```

---

## 2. Firebase Project Configuration (`lasued-intel`)

Client configuration lives in `/firebase-applet-config.json` and targets:

- **Project ID**: `lasued-intel`
- **Auth Domain**: `lasued-intel.firebaseapp.com`
- **Firestore Database ID**: `(default)`
- **Storage Bucket**: `lasued-intel.firebasestorage.app`

Note: Client media uploads use compressed WebP/JPEG payloads stored in the `mediaImages` Firestore collection (enforced `<= 250,000` bytes / `<= 340,000` Base64 chars in `firestore.rules`); Firebase Cloud Storage is not required for standard uploads.

### One-Time Firebase Console Setup
1. Open **Firebase Console -> Project `lasued-intel`**.
2. **Authentication -> Sign-in method**:
   - Enable **Email/Password**.
   - Ensure Email verification & Password reset templates point cleanly to `https://lasuedintel.com.ng`.
3. **Authentication -> Settings -> Authorized domains**:
   - Add `lasuedintel.com.ng`
   - Add `www.lasuedintel.com.ng`
   - Add your Vercel domain (e.g. `lasued-intel.vercel.app`)
   - Keep `localhost` for local testing.
4. **Firestore Database**:
   - Ensure the `(default)` Firestore database exists in Native mode.

### Deploy Firestore Rules & Composite Indexes

```bash
firebase login
firebase use lasued-intel
firebase deploy --only firestore
```

`/firebase.json` is preconfigured to deploy `/firestore.rules` and `/firestore.indexes.json`.

---

## 3. Security & Two-Admin Governance Architecture

- **Strict Two-Admin Lock**:
  - Public Supreme Admin: `lasuedintel@gmail.com`
  - Underground Supreme Admin: `awoyinfasolomon1@gmail.com` (operates anonymously under **LASUED Intel Official** in official updates and remains hidden from the public member directory).
- No other email address holds Supreme Admin escalation rights in client rules, `src/config/roles.ts`, or `firestore.rules`.
- Elevated roles (`moderator`, `verified`) can only be granted or revoked from the Admin workspace by an authenticated, email-verified designated Supreme Admin.
- Anonymous posts/comments exclude `ownerUID` from public documents and isolate author UIDs inside `anonymousIdentityMappings`, readable only by designated Supreme Admins.

---

## 4. Environment Variables (`.env.example`)

Copy `.env.example` to `.env.local` for local testing or configure these 9 variables in **Vercel -> Project Settings -> Environment Variables**:

| Variable | Scope | Description |
| --- | --- | --- |
| `VITE_APP_NAME` | Client + Build | Display title override (defaults to `LASUED Intel`) |
| `VITE_PUBLIC_BASE_URL` | Client + Server | Canonical production origin (`https://lasuedintel.com.ng`) |
| `VITE_WEB_PUSH_VAPID_PUBLIC_KEY` | Client + Build | Optional VAPID public key for browser push subscriptions |
| `FIREBASE_FIRESTORE_DATABASE_ID` | Server (`/api/*`) | Firestore database ID (`(default)`) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Server (`/api/*`) | Firebase Admin SDK service-account JSON (single-line JSON or base64) for project `lasued-intel` |
| `PUSH_WEBHOOK_SECRET` | Server (`/api/*`) | Shared secret protecting internal/webhook triggers to `/api/push/*` |
| `WEB_PUSH_VAPID_PUBLIC_KEY` | Server (`/api/*`) | Must match `VITE_WEB_PUSH_VAPID_PUBLIC_KEY` |
| `WEB_PUSH_VAPID_PRIVATE_KEY` | Server (`/api/*`) | Private VAPID key used by `web-push` (never prefix with `VITE_`) |
| `WEB_PUSH_VAPID_SUBJECT` | Server (`/api/*`) | Contact URI such as `mailto:lasuedintel@gmail.com` |

**Security rule**: Never prefix `FIREBASE_SERVICE_ACCOUNT_JSON`, `WEB_PUSH_VAPID_PRIVATE_KEY`, or `PUSH_WEBHOOK_SECRET` with `VITE_`.

---

## 5. Vercel Deployment & WhoGoHost DNS

### Vercel Configuration (`/vercel.json`)
- Static assets (`/sitemap.xml`, `/robots.txt`, `/site.webmanifest`, `/favicon.ico`, `/favicon.svg`, `/favicon-*.png`, `/og-share.png`, `/pwa-*.png`, `/apple-touch-icon.png`) and `/api/*` are served directly with appropriate `Content-Type`, cache, and security headers.
- All frontend routes rewrite cleanly to `/index.html`.
- Dynamic server routes `/api/sitemap` and `/api/robots` mirror `/sitemap.xml` and `/robots.txt` using `resolveServerPublicOrigin`.

### WhoGoHost DNS Setup for `lasuedintel.com.ng`
1. In Vercel -> **Project -> Settings -> Domains**, add `lasuedintel.com.ng` and `www.lasuedintel.com.ng` (configure `www` to redirect to apex `https://lasuedintel.com.ng`).
2. In WhoGoHost DNS Zone Editor:
   - Set **A Record** `@` -> `76.76.21.21` (or the exact IP displayed in Vercel Domains UI).
   - Set **CNAME Record** `www` -> `cname.vercel-dns.com` (or the exact CNAME displayed by Vercel).
   - Preserve the existing Google Search Console **TXT** verification record (`google-site-verification=H2i33HKIDhiSwMs-rBQGhlRs7gDXAxJF6QLO3o7gUMg`).

---

## 6. SEO & Google Search Console Checklist

- Canonical URLs across HTML `<link rel="canonical">`, Open Graph, Twitter/X cards, JSON-LD `@graph`, and share links resolve to `https://lasuedintel.com.ng`.
- Crawlable `<a href>` navigation links exist in the header, sidebar, and footer while preserving instant SPA navigation.
- Indexable public sections use `index, follow`; auth (`login`, `register`), personal (`account`, `notifications`, `following`, `saved`, `anonymous` profile tabs), moderation (`pending_approvals`), active search queries, and `admin` views emit `noindex, nofollow`.
- After production deploy, verify live availability of:
  - `https://lasuedintel.com.ng/sitemap.xml`
  - `https://lasuedintel.com.ng/robots.txt`
  - `https://lasuedintel.com.ng/site.webmanifest`
  - `https://lasuedintel.com.ng/favicon.ico`
  - `https://lasuedintel.com.ng/og-share.png`
- In Google Search Console (`https://lasuedintel.com.ng`), submit `sitemap.xml` and inspect `https://lasuedintel.com.ng/`.
