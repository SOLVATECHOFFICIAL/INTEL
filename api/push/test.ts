import crypto from 'node:crypto';
import { clampTestPushOptions } from '../_lib/pushSanitizer.js';
import {
  deliverWebPushTestToRecipient,
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

  const body = (await readJsonBody(req)) ?? {};
  const { count, delaySeconds } = clampTestPushOptions({
    count: body.count,
    delaySeconds: body.delaySeconds,
  });

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
  if (!caller || caller.kind !== 'user') {
    sendJson(res, 401, {
      error: 'Sign in required to send a test push notification.',
    });
    return;
  }

  if (caller.isSuspended) {
    sendJson(res, 403, {
      error: 'Suspended accounts cannot dispatch test notifications.',
    });
    return;
  }

  const batchId = crypto.randomBytes(6).toString('hex');
  const summary = await deliverWebPushTestToRecipient(clients.db, {
    recipientUid: caller.uid,
    batchId,
    count,
    delaySeconds,
    allowedOrigin: config.allowedOrigin,
  });

  sendJson(res, 200, {
    ok: summary.delivered > 0,
    configured: true,
    batchId,
    count,
    delaySeconds,
    ...summary,
  });
}
