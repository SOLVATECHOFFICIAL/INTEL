import {
  getServerPushConfigStatus,
  sendJson,
  type VercelLikeRequest,
  type VercelLikeResponse,
} from '../_lib/pushServer';

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const config = getServerPushConfigStatus(req.headers);
  const configured = config.vapidConfigured && config.firebaseAdminConfigured;

  sendJson(res, 200, {
    configured,
    vapidPublicKey: configured ? config.vapidPublicKey : null,
  });
}
