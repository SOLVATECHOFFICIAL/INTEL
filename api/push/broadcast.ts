import {
  computeBroadcastDedupId,
  isValidFirestoreId,
  sanitizeInternalTargetPath,
} from '../_lib/pushSanitizer';
import {
  claimPushDedupLock,
  deliverWebPushToRecipient,
  ensureWebPushConfigured,
  getAdminClients,
  getServerPushConfigStatus,
  readJsonBody,
  sendJson,
  verifyPushApiCaller,
  type VercelLikeRequest,
  type VercelLikeResponse,
} from '../_lib/pushServer';

const ALLOWED_BROADCAST_EVENTS = new Set([
  'new_event',
  'new_opportunity',
  'announcement',
  'official_update',
]);

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const body = await readJsonBody(req);
  if (!body) {
    sendJson(res, 400, { error: 'Invalid JSON request body.' });
    return;
  }

  const eventType =
    typeof body.eventType === 'string' ? body.eventType.trim() : '';
  const rawTitle =
    typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim() : '';
  if (!ALLOWED_BROADCAST_EVENTS.has(eventType) || !rawTitle) {
    sendJson(res, 400, {
      error: 'Valid broadcast eventType and title are required.',
    });
    return;
  }

  const config = getServerPushConfigStatus(req.headers);
  const clients = getAdminClients();
  if (!clients || !config.vapidConfigured || !ensureWebPushConfigured()) {
    sendJson(res, 200, {
      ok: false,
      configured: false,
      skipped: true,
    });
    return;
  }

  const caller = await verifyPushApiCaller(req, clients.auth, clients.db);
  if (!caller) {
    sendJson(res, 401, { error: 'Authentication required.' });
    return;
  }
  if (caller.kind === 'user') {
    if (caller.isSuspended || caller.role !== 'supreme_admin') {
      sendJson(res, 403, {
        error: 'Only Supreme Admin accounts can broadcast push alerts.',
      });
      return;
    }
  }

  const cleanTitle = rawTitle.slice(0, 120);
  const cleanBody =
    typeof body.body === 'string'
      ? body.body.replace(/\s+/g, ' ').trim().slice(0, 240)
      : undefined;
  const targetPath = sanitizeInternalTargetPath(
    body.targetPath,
    config.allowedOrigin
  );

  const requestedUids = Array.isArray(body.recipientUids)
    ? Array.from(
        new Set(body.recipientUids.filter((id): id is string => isValidFirestoreId(id)))
      ).slice(0, 500)
    : null;

  const firstNotifId =
    Array.isArray(body.notificationIds) &&
    isValidFirestoreId(body.notificationIds[0])
      ? body.notificationIds[0]
      : undefined;

  const dedupId = computeBroadcastDedupId({
    eventType,
    title: cleanTitle,
    targetPath,
    firstNotificationId: firstNotifId,
  });
  const claimed = await claimPushDedupLock(clients.db, dedupId);
  if (!claimed) {
    sendJson(res, 200, { ok: true, deduplicated: true });
    return;
  }

  // Group active subscriptions per user via a single collectionGroup read when possible
  const subsByUid = new Map<
    string,
    Array<{ id: string; endpoint: string; p256dh: string; auth: string }>
  >();

  try {
    const allowedSet = requestedUids ? new Set(requestedUids) : null;
    const PAGE_SIZE = 400;
    const MAX_PAGES = 12;
    let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      let groupQuery = clients.db
        .collectionGroup('pushSubscriptions')
        .orderBy('__name__')
        .limit(PAGE_SIZE);
      if (lastDoc) {
        groupQuery = groupQuery.startAfter(lastDoc);
      }
      const groupSnap = await groupQuery.get();
      if (groupSnap.empty) break;

      for (const docSnap of groupSnap.docs) {
        const data = docSnap.data() ?? {};
        const uid =
          typeof data.uid === 'string' && isValidFirestoreId(data.uid)
            ? data.uid
            : docSnap.ref.parent.parent?.id ?? '';
        if (!isValidFirestoreId(uid)) continue;
        if (allowedSet && !allowedSet.has(uid)) continue;

        const list = subsByUid.get(uid) ?? [];
        list.push({
          id: docSnap.id,
          endpoint: String(data.endpoint ?? ''),
          p256dh: String(data.p256dh ?? ''),
          auth: String(data.auth ?? ''),
        });
        subsByUid.set(uid, list);
      }

      if (groupSnap.docs.length < PAGE_SIZE) break;
      lastDoc = groupSnap.docs[groupSnap.docs.length - 1];
    }
  } catch {
    // Fallback if collectionGroup query is unavailable: deliver directly per recipient
    if (requestedUids && requestedUids.length > 0) {
      for (const uid of requestedUids.slice(0, 500)) {
        subsByUid.set(uid, []);
      }
    } else {
      try {
        const activeSnap = await clients.db
          .collection('users')
          .where('accountStatus', '==', 'active')
          .select()
          .limit(500)
          .get();
        for (const userDoc of activeSnap.docs) {
          if (isValidFirestoreId(userDoc.id)) {
            subsByUid.set(userDoc.id, []);
          }
        }
      } catch {
        // Unable to enumerate users in fallback mode
      }
    }
  }

  let attempted = 0;
  let delivered = 0;
  let pruned = 0;
  let failed = 0;

  const entries = Array.from(subsByUid.entries());
  const CHUNK_SIZE = 15;
  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE);
    const chunkResults = await Promise.all(
      chunk.map(([uid, subs]) =>
        deliverWebPushToRecipient(clients.db, {
          recipientUid: uid,
          eventType,
          title: cleanTitle,
          body: cleanBody,
          targetPath,
          allowedOrigin: config.allowedOrigin,
          preloadedSubscriptions: subs.length > 0 ? subs : undefined,
        })
      )
    );
    for (const item of chunkResults) {
      attempted += item.attempted;
      delivered += item.delivered;
      pruned += item.pruned;
      failed += item.failed;
    }
  }

  sendJson(res, 200, {
    ok: true,
    recipientsTargeted: entries.length,
    attempted,
    delivered,
    pruned,
    failed,
  });
}
