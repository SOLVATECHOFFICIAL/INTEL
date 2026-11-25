import {
  isValidVapidPrivateKey,
  isValidVapidPublicKey,
  normalizeVapidKey,
  normalizeVapidSubject,
  unquoteEnvValue,
} from './pushSanitizer.js';
import { resolveServerPublicOrigin } from './siteOrigin.js';

export interface VercelLikeRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | string>;
}

export interface VercelLikeResponse {
  statusCode?: number;
  setHeader: (name: string, value: string) => void;
  status?: (code: number) => VercelLikeResponse;
  json?: (payload: unknown) => void;
  end: (chunk?: string) => void;
}

export interface ParsedServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

const DEFAULT_FIRESTORE_DB_ID = '(default)';

export function sendJson(
  res: VercelLikeResponse,
  statusCode: number,
  payload: Record<string, unknown>
): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    const target = res.status(statusCode);
    if (target && typeof target.json === 'function') {
      target.json(payload);
      return;
    }
  }
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

export function getHeaderValue(
  req: VercelLikeRequest,
  headerName: string
): string {
  const lower = headerName.toLowerCase();
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    if (key.toLowerCase() === lower) {
      if (Array.isArray(value)) return (value[0] ?? '').trim();
      return typeof value === 'string' ? value.trim() : '';
    }
  }
  return '';
}

export async function readJsonBody(
  req: VercelLikeRequest
): Promise<Record<string, unknown> | null> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Array.isArray(req.body)) {
      return req.body as Record<string, unknown>;
    }
    if (typeof req.body === 'string') {
      try {
        const parsed = JSON.parse(req.body);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  if (typeof req[Symbol.asyncIterator] === 'function') {
    try {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      for await (const chunk of req as AsyncIterable<Uint8Array | string>) {
        const buf =
          typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
        totalBytes += buf.byteLength;
        if (totalBytes > 128 * 1024) {
          return null;
        }
        chunks.push(buf);
      }
      if (chunks.length === 0) return {};
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  return {};
}

export function parseServiceAccountJson(
  raw: string | undefined
): ParsedServiceAccount | null {
  const cleaned = unquoteEnvValue(raw);
  if (!cleaned) return null;

  const candidates: string[] = [cleaned];
  if (cleaned.includes('\\"')) {
    candidates.push(cleaned.replace(/\\"/g, '"'));
  }
  if (!cleaned.startsWith('{')) {
    try {
      const normalizedB64 = cleaned
        .replace(/\s+/g, '')
        .replace(/-/g, '+')
        .replace(/_/g, '/');
      const paddedB64 =
        normalizedB64 + '='.repeat((4 - (normalizedB64.length % 4)) % 4);
      const decoded = Buffer.from(paddedB64, 'base64').toString('utf8').trim();
      if (decoded) {
        candidates.push(unquoteEnvValue(decoded));
      }
    } catch {
      // Ignore base64 fallback error
    }
  }

  for (const candidate of candidates) {
    try {
      let parsed: unknown = JSON.parse(candidate);
      if (typeof parsed === 'string') {
        parsed = JSON.parse(parsed);
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        continue;
      }
      const record = parsed as Record<string, unknown>;
      const projectId =
        typeof record.project_id === 'string' ? record.project_id.trim() : '';
      const clientEmail =
        typeof record.client_email === 'string' ? record.client_email.trim() : '';
      const rawKey =
        typeof record.private_key === 'string' ? record.private_key : '';
      const privateKey = rawKey.replace(/\\n/g, '\n').trim();
      if (
        projectId &&
        clientEmail &&
        (privateKey.includes('BEGIN PRIVATE KEY') ||
          privateKey.includes('BEGIN RSA PRIVATE KEY'))
      ) {
        return {
          projectId,
          clientEmail,
          privateKey,
        };
      }
    } catch {
      // Continue trying candidates
    }
  }
  return null;
}

export function resolveNormalizedFirestoreDatabaseId(
  raw: string | undefined = process.env.FIREBASE_FIRESTORE_DATABASE_ID
): string {
  const unquoted = unquoteEnvValue(raw);
  return unquoted || DEFAULT_FIRESTORE_DB_ID;
}

export function getServerPushConfigStatus(
  reqHeaders?: Record<string, string | string[] | undefined>
): {
  vapidConfigured: boolean;
  firebaseAdminConfigured: boolean;
  vapidPublicKey: string | null;
  vapidPrivateKey: string | null;
  vapidSubject: string;
  allowedOrigin: string;
} {
  const rawPublicKey =
    normalizeVapidKey(process.env.WEB_PUSH_VAPID_PUBLIC_KEY) ||
    normalizeVapidKey(process.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY);
  const rawPrivateKey = normalizeVapidKey(process.env.WEB_PUSH_VAPID_PRIVATE_KEY);
  const subject = normalizeVapidSubject(process.env.WEB_PUSH_VAPID_SUBJECT);
  const serviceAccount = parseServiceAccountJson(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  );
  const allowedOrigin = resolveServerPublicOrigin(reqHeaders);

  const publicValid = isValidVapidPublicKey(rawPublicKey);
  const privateValid = isValidVapidPrivateKey(rawPrivateKey);
  const vapidConfigured = publicValid && privateValid;

  return {
    vapidConfigured,
    firebaseAdminConfigured: Boolean(serviceAccount),
    vapidPublicKey: publicValid ? rawPublicKey : null,
    vapidPrivateKey: privateValid ? rawPrivateKey : null,
    vapidSubject: subject,
    allowedOrigin,
  };
}

export function getServerPushConfigDiagnostics(
  reqHeaders?: Record<string, string | string[] | undefined>
): {
  vapidPublicKeyValid: boolean;
  vapidPrivateKeyValid: boolean;
  vapidKeysMatchClientEnv: boolean;
  firebaseServiceAccountValid: boolean;
  firestoreDatabaseId: string;
  webhookSecretConfigured: boolean;
  vapidSubjectValid: boolean;
  allowedOrigin: string;
  issues: string[];
} {
  const serverPub = normalizeVapidKey(process.env.WEB_PUSH_VAPID_PUBLIC_KEY);
  const clientPub = normalizeVapidKey(process.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY);
  const privKey = normalizeVapidKey(process.env.WEB_PUSH_VAPID_PRIVATE_KEY);
  const serviceAccountRaw = unquoteEnvValue(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const serviceAccount = parseServiceAccountJson(serviceAccountRaw);
  const dbId = resolveNormalizedFirestoreDatabaseId();
  const webhookSecret = unquoteEnvValue(process.env.PUSH_WEBHOOK_SECRET);
  const subject = normalizeVapidSubject(process.env.WEB_PUSH_VAPID_SUBJECT);
  const allowedOrigin = resolveServerPublicOrigin(reqHeaders);

  const effectivePub = serverPub || clientPub;
  const vapidPublicKeyValid = isValidVapidPublicKey(effectivePub);
  const vapidPrivateKeyValid = isValidVapidPrivateKey(privKey);
  const vapidKeysMatchClientEnv =
    !serverPub || !clientPub || serverPub === clientPub;
  const firebaseServiceAccountValid = Boolean(serviceAccount);
  const vapidSubjectValid = /^(mailto:|https:\/\/)/i.test(subject);

  const issues: string[] = [];
  if (!vapidPublicKeyValid) {
    issues.push(
      'Missing or malformed WEB_PUSH_VAPID_PUBLIC_KEY / VITE_WEB_PUSH_VAPID_PUBLIC_KEY.'
    );
  }
  if (!vapidPrivateKeyValid) {
    issues.push('Missing or malformed WEB_PUSH_VAPID_PRIVATE_KEY.');
  }
  if (!vapidKeysMatchClientEnv) {
    issues.push(
      'WEB_PUSH_VAPID_PUBLIC_KEY and VITE_WEB_PUSH_VAPID_PUBLIC_KEY do not match.'
    );
  }
  if (!firebaseServiceAccountValid) {
    issues.push(
      serviceAccountRaw
        ? 'FIREBASE_SERVICE_ACCOUNT_JSON is set but failed JSON/PEM/base64 validation.'
        : 'Missing FIREBASE_SERVICE_ACCOUNT_JSON.'
    );
  }
  if (!webhookSecret) {
    issues.push('Optional PUSH_WEBHOOK_SECRET is not set.');
  }

  return {
    vapidPublicKeyValid,
    vapidPrivateKeyValid,
    vapidKeysMatchClientEnv,
    firebaseServiceAccountValid,
    firestoreDatabaseId: dbId,
    webhookSecretConfigured: Boolean(webhookSecret),
    vapidSubjectValid,
    allowedOrigin,
    issues,
  };
}
