import {
  getServerPushConfigDiagnostics,
  getServerPushConfigStatus,
  sendJson,
  type VercelLikeRequest,
  type VercelLikeResponse,
} from '../_lib/pushServer.js';

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    const config = getServerPushConfigStatus(req.headers);
    const configured = config.vapidConfigured && config.firebaseAdminConfigured;

    const wantsDiagnostics = (() => {
      if (typeof req.url !== 'string' || !req.url.includes('?')) return false;
      try {
        const parsed = new URL(req.url, 'https://localhost');
        return parsed.searchParams.get('diagnostics') === '1';
      } catch {
        return false;
      }
    })();

    sendJson(res, 200, {
      configured,
      vapidPublicKey: configured ? config.vapidPublicKey : null,
      ...(wantsDiagnostics
        ? { diagnostics: getServerPushConfigDiagnostics(req.headers) }
        : {}),
    });
  } catch {
    sendJson(res, 200, {
      configured: false,
      vapidPublicKey: null,
    });
  }
}
