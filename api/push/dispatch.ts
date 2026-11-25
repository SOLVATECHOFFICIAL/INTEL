import { isValidFirestoreId } from '../_lib/pushSanitizer.js';
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
} from '../_lib/pushServer.js';

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const body = await readJsonBody(req);
  if (!body || !isValidFirestoreId(body.notificationId)) {
    sendJson(res, 400, { error: 'A valid notificationId is required.' });
    return;
  }
  const notificationId = body.notificationId;

  const config = getServerPushConfigStatus(req.headers);
  const clients = getAdminClients();
  if (!clients || !config.vapidConfigured || !(await ensureWebPushConfigured())) {
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
  if (caller.kind === 'user' && caller.isSuspended) {
    sendJson(res, 403, { error: 'Suspended accounts cannot dispatch notifications.' });
    return;
  }

  let notifSnap = await clients.db
    .collection('notifications')
    .doc(notificationId)
    .get();

  if (!notifSnap.exists) {
    for (const delayMs of [150, 350]) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      notifSnap = await clients.db
        .collection('notifications')
        .doc(notificationId)
        .get();
      if (notifSnap.exists) break;
    }
  }

  if (!notifSnap.exists) {
    sendJson(res, 404, { error: 'Notification record not found.' });
    return;
  }

  const notif = notifSnap.data() ?? {};
  const recipientUid = String(notif.recipientUid ?? '');
  const actorUid = typeof notif.actorUid === 'string' ? notif.actorUid : '';
  const eventType = String(notif.eventType ?? '');

  if (!isValidFirestoreId(recipientUid)) {
    sendJson(res, 400, { error: 'Notification recipient is invalid.' });
    return;
  }

  if (caller.kind === 'user') {
    const isAdmin = caller.role === 'supreme_admin';
    const isMarketplaceModerator =
      caller.role === 'moderator' &&
      (eventType === 'marketplace_approved' ||
        eventType === 'marketplace_rejected');
    const isActor = Boolean(actorUid) && caller.uid === actorUid;
    const isSelfSynced =
      caller.uid === recipientUid &&
      (eventType === 'anonymous_reply' ||
        eventType === 'anonymous_reaction' ||
        eventType === 'marketplace_expired');

    if (!isAdmin && !isMarketplaceModerator && !isActor && !isSelfSynced) {
      sendJson(res, 403, { error: 'Not authorized to dispatch this notification.' });
      return;
    }
  }

  const dedupClaimed = await claimPushDedupLock(
    clients.db,
    `notif_${notificationId.slice(0, 118)}`
  );
  if (!dedupClaimed) {
    sendJson(res, 200, { ok: true, deduplicated: true });
    return;
  }

  const summary = await deliverWebPushToRecipient(clients.db, {
    recipientUid,
    notificationId,
    eventType,
    title: String(notif.title ?? 'LASUED Intel'),
    body: typeof notif.body === 'string' ? notif.body : undefined,
    targetPath:
      typeof notif.targetPath === 'string' ? notif.targetPath : undefined,
    allowedOrigin: config.allowedOrigin,
  });

  sendJson(res, 200, {
    ok: true,
    ...summary,
  });
}
