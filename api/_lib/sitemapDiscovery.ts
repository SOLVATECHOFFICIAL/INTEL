import fs from 'node:fs';
import path from 'node:path';
import type { SitemapImageEntry, SitemapUrlEntry } from './siteOrigin.js';

interface FirestoreStringValue {
  stringValue?: string;
}

interface FirestoreTimestampValue {
  timestampValue?: string;
}

interface FirestoreFieldMap {
  [key: string]:
    | FirestoreStringValue
    | FirestoreTimestampValue
    | { booleanValue?: boolean }
    | { arrayValue?: { values?: Array<{ stringValue?: string }> } }
    | undefined;
}

interface FirestoreRunQueryRow {
  document?: {
    name?: string;
    fields?: FirestoreFieldMap;
    updateTime?: string;
  };
}

function readFirebaseProjectTarget(): { projectId: string; databaseId: string } {
  const envProject = (process.env.FIREBASE_PROJECT_ID ?? '').trim();
  const envDb = (process.env.FIREBASE_FIRESTORE_DATABASE_ID ?? '').trim();
  if (envProject) {
    return {
      projectId: envProject,
      databaseId: envDb || '(default)',
    };
  }

  try {
    const raw = fs.readFileSync(path.resolve('firebase-applet-config.json'), 'utf8');
    const parsed = JSON.parse(raw) as {
      projectId?: unknown;
      firestoreDatabaseId?: unknown;
    };
    const projectId =
      typeof parsed.projectId === 'string' && parsed.projectId.trim()
        ? parsed.projectId.trim()
        : 'lasued-intel';
    const databaseId =
      typeof parsed.firestoreDatabaseId === 'string' &&
      parsed.firestoreDatabaseId.trim()
        ? parsed.firestoreDatabaseId.trim()
        : '(default)';
    return { projectId, databaseId };
  } catch {
    return { projectId: 'lasued-intel', databaseId: '(default)' };
  }
}

function docIdFromName(name?: string): string | null {
  if (!name) return null;
  const idx = name.lastIndexOf('/');
  if (idx < 0) return null;
  const id = name.slice(idx + 1).trim();
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id) ? id : null;
}

function readStringField(
  fields: FirestoreFieldMap | undefined,
  key: string
): string | null {
  const raw = fields?.[key];
  if (!raw || !('stringValue' in raw) || typeof raw.stringValue !== 'string') {
    return null;
  }
  const trimmed = raw.stringValue.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readLastmodIso(
  fields: FirestoreFieldMap | undefined,
  docUpdateTime?: string
): string | undefined {
  for (const key of ['updatedAt', 'createdAt', 'eventDate']) {
    const val = fields?.[key];
    if (val && 'timestampValue' in val && typeof val.timestampValue === 'string') {
      const parsed = Date.parse(val.timestampValue);
      if (Number.isFinite(parsed)) {
        return new Date(parsed).toISOString().slice(0, 10);
      }
    }
  }
  if (docUpdateTime) {
    const parsed = Date.parse(docUpdateTime);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString().slice(0, 10);
    }
  }
  return undefined;
}

function buildPublicImageEntry(
  rawUrl: string | null,
  title: string,
  caption?: string
): SitemapImageEntry[] {
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'https:') {
        return [
          {
            loc: parsed.toString(),
            title: title.slice(0, 120),
            ...(caption ? { caption: caption.slice(0, 220) } : {}),
          },
        ];
      }
    } catch {
      // Fallback to official preview card
    }
  }

  return [
    {
      loc: '/og-share.png',
      title: title.slice(0, 120),
      ...(caption ? { caption: caption.slice(0, 220) } : {}),
    },
  ];
}

async function runPublicFirestoreQuery(
  projectId: string,
  databaseId: string,
  structuredQuery: Record<string, unknown>,
  timeoutMs = 2200
): Promise<FirestoreRunQueryRow[]> {
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/${encodeURIComponent(databaseId)}/documents:runQuery`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ structuredQuery }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return [];
    }
    const payload = (await response.json()) as unknown;
    return Array.isArray(payload) ? (payload as FirestoreRunQueryRow[]) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function summarizeTitle(raw: string | null, fallback: string): string {
  if (!raw) return fallback;
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallback;
  return cleaned.length > 90 ? `${cleaned.slice(0, 87)}...` : cleaned;
}

export async function fetchPublicSitemapEntries(): Promise<SitemapUrlEntry[]> {
  const { projectId, databaseId } = readFirebaseProjectTarget();

  const [
    updatesRows,
    postsRows,
    marketplaceRows,
    opportunitiesRows,
    eventsRows,
    anonymousRows,
    usersRows,
  ] = await Promise.all([
    runPublicFirestoreQuery(projectId, databaseId, {
      from: [{ collectionId: 'adminUpdates' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'EQUAL',
          value: { stringValue: 'published' },
        },
      },
      limit: 30,
    }),
    runPublicFirestoreQuery(projectId, databaseId, {
      from: [{ collectionId: 'posts' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'EQUAL',
          value: { stringValue: 'published' },
        },
      },
      limit: 40,
    }),
    runPublicFirestoreQuery(projectId, databaseId, {
      from: [{ collectionId: 'marketplace' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'EQUAL',
          value: { stringValue: 'active' },
        },
      },
      limit: 30,
    }),
    runPublicFirestoreQuery(projectId, databaseId, {
      from: [{ collectionId: 'opportunities' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'IN',
          value: {
            arrayValue: {
              values: [{ stringValue: 'active' }, { stringValue: 'expired' }],
            },
          },
        },
      },
      limit: 30,
    }),
    runPublicFirestoreQuery(projectId, databaseId, {
      from: [{ collectionId: 'events' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'IN',
          value: {
            arrayValue: {
              values: [
                { stringValue: 'published' },
                { stringValue: 'completed' },
                { stringValue: 'active' },
                { stringValue: 'upcoming' },
              ],
            },
          },
        },
      },
      limit: 25,
    }),
    runPublicFirestoreQuery(projectId, databaseId, {
      from: [{ collectionId: 'anonymousPosts' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'EQUAL',
          value: { stringValue: 'published' },
        },
      },
      limit: 25,
    }),
    runPublicFirestoreQuery(projectId, databaseId, {
      from: [{ collectionId: 'users' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'isHiddenFromDirectory' },
          op: 'EQUAL',
          value: { booleanValue: false },
        },
      },
      limit: 30,
    }),
  ]);

  const entries: SitemapUrlEntry[] = [];

  for (const row of updatesRows) {
    const id = docIdFromName(row.document?.name);
    if (!id) continue;
    const fields = row.document?.fields;
    const title = summarizeTitle(
      readStringField(fields, 'title'),
      'Official Campus Update — LASUED Intel'
    );
    const caption = summarizeTitle(
      readStringField(fields, 'content'),
      'Verified campus briefing on LASUED Intel.'
    );
    entries.push({
      path: `/?view=updates&postId=${encodeURIComponent(id)}`,
      changefreq: 'daily',
      priority: '0.8',
      lastmod: readLastmodIso(fields, row.document?.updateTime),
      images: buildPublicImageEntry(
        readStringField(fields, 'mediaUrl'),
        title,
        caption
      ),
    });
  }

  for (const row of opportunitiesRows) {
    const id = docIdFromName(row.document?.name);
    if (!id) continue;
    const fields = row.document?.fields;
    const title = summarizeTitle(
      readStringField(fields, 'title'),
      'LASUED Student Opportunity — LASUED Intel'
    );
    const caption = summarizeTitle(
      readStringField(fields, 'description'),
      'Student opportunity listed on LASUED Intel.'
    );
    entries.push({
      path: `/?view=opportunities&opportunityId=${encodeURIComponent(id)}`,
      changefreq: 'daily',
      priority: '0.8',
      lastmod: readLastmodIso(fields, row.document?.updateTime),
      images: buildPublicImageEntry(null, title, caption),
    });
  }

  for (const row of eventsRows) {
    const id = docIdFromName(row.document?.name);
    if (!id) continue;
    const fields = row.document?.fields;
    const title = summarizeTitle(
      readStringField(fields, 'title'),
      'LASUED Campus Event — LASUED Intel'
    );
    const caption = summarizeTitle(
      readStringField(fields, 'description'),
      'Campus event listed on LASUED Intel.'
    );
    entries.push({
      path: `/?view=upcoming-events&eventId=${encodeURIComponent(id)}`,
      changefreq: 'daily',
      priority: '0.75',
      lastmod: readLastmodIso(fields, row.document?.updateTime),
      images: buildPublicImageEntry(
        readStringField(fields, 'flyerUrl'),
        title,
        caption
      ),
    });
  }

  for (const row of marketplaceRows) {
    const id = docIdFromName(row.document?.name);
    if (!id) continue;
    const fields = row.document?.fields;
    const title = summarizeTitle(
      readStringField(fields, 'title'),
      'LASUED Marketplace Listing — LASUED Intel'
    );
    const caption = summarizeTitle(
      readStringField(fields, 'description'),
      'Student marketplace listing on LASUED Intel.'
    );
    entries.push({
      path: `/?view=marketplace&listingId=${encodeURIComponent(id)}`,
      changefreq: 'daily',
      priority: '0.75',
      lastmod: readLastmodIso(fields, row.document?.updateTime),
      images: buildPublicImageEntry(null, title, caption),
    });
  }

  for (const row of postsRows) {
    const id = docIdFromName(row.document?.name);
    if (!id) continue;
    const fields = row.document?.fields;
    const title = summarizeTitle(
      readStringField(fields, 'text'),
      'Campus Post — LASUED Intel'
    );
    entries.push({
      path: `/?view=for-you&postId=${encodeURIComponent(id)}`,
      changefreq: 'daily',
      priority: '0.7',
      lastmod: readLastmodIso(fields, row.document?.updateTime),
      images: buildPublicImageEntry(
        readStringField(fields, 'mediaUrl'),
        title
      ),
    });
  }

  for (const row of anonymousRows) {
    const id = docIdFromName(row.document?.name);
    if (!id) continue;
    const fields = row.document?.fields;
    const title = summarizeTitle(
      readStringField(fields, 'text'),
      'The Unfiltered Campus Discussion — LASUED Intel'
    );
    entries.push({
      path: `/?view=anonymous&postId=${encodeURIComponent(id)}`,
      changefreq: 'daily',
      priority: '0.65',
      lastmod: readLastmodIso(fields, row.document?.updateTime),
      images: buildPublicImageEntry(null, title),
    });
  }

  for (const row of usersRows) {
    const fields = row.document?.fields;
    const username = readStringField(fields, 'username')?.toLowerCase();
    if (!username || !/^[a-z0-9_]{3,32}$/.test(username)) continue;
    const fullName = summarizeTitle(
      readStringField(fields, 'fullName'),
      `@${username}`
    );
    entries.push({
      path: `/?view=profile&username=${encodeURIComponent(username)}`,
      changefreq: 'weekly',
      priority: '0.6',
      lastmod: readLastmodIso(fields, row.document?.updateTime),
      images: buildPublicImageEntry(
        readStringField(fields, 'photoUrl'),
        `${fullName} (@${username}) — LASUED Intel`
      ),
    });
  }

  return entries;
}
