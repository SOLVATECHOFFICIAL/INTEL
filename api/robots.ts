import {
  buildRobotsTxt,
  resolveServerPublicOrigin,
} from './_lib/siteOrigin.js';
import type { VercelLikeRequest, VercelLikeResponse } from './_lib/pushServer.js';

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const origin = resolveServerPublicOrigin(req.headers);
  const body = buildRobotsTxt(origin);

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.statusCode = 200;
  res.end(req.method === 'HEAD' ? '' : body);
}
