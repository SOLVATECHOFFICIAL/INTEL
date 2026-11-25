import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import * as webpush from 'web-push';
import fs from 'node:fs';
import path from 'node:path';
import configHandler from './config.js';
import dispatchHandler from './dispatch.js';
import broadcastHandler from './broadcast.js';
import testHandler from './test.js';
import {
  buildTestPushPayloads,
  clampTestPushOptions,
  isNotificationAllowedByRawPrefs,
  normalizeVapidKey,
  normalizeVapidSubject,
  sanitizePushPayloadForClient,
  unquoteEnvValue,
} from '../_lib/pushSanitizer.js';
import {
  parseServiceAccountJson,
  resolveNormalizedFirestoreDatabaseId,
  shouldPrunePushFailure,
  type VercelLikeRequest,
  type VercelLikeResponse,
} from '../_lib/pushServer.js';

function createMockRes(): {
  res: VercelLikeResponse;
  getStatus: () => number;
  getBody: () => Record<string, unknown>;
} {
  let statusCode = 200;
  let body = '';
  const headers: Record<string, string> = {};

  const res: VercelLikeResponse = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    status(code: number) {
      statusCode = code;
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = JSON.stringify(payload);
    },
    end(chunk?: string) {
      if (typeof chunk === 'string') {
        body = chunk;
      }
      statusCode = this.statusCode ?? statusCode;
    },
  };

  return {
    res,
    getStatus: () => statusCode,
    getBody: () => (body ? (JSON.parse(body) as Record<string, unknown>) : {}),
  };
}

test('/api/push/config rejects non-GET/HEAD requests and omits secrets when unconfigured', async () => {
  const postMock = createMockRes();
  await configHandler(
    { method: 'POST', headers: {} } as VercelLikeRequest,
    postMock.res
  );
  assert.equal(postMock.getStatus(), 405);

  const savedPub = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const savedPriv = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const savedSa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  try {
    delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
    delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    const getMock = createMockRes();
    await configHandler(
      { method: 'GET', headers: {} } as VercelLikeRequest,
      getMock.res
    );
    assert.equal(getMock.getStatus(), 200);
    assert.deepEqual(getMock.getBody(), {
      configured: false,
      vapidPublicKey: null,
    });
  } finally {
    if (savedPub !== undefined) process.env.WEB_PUSH_VAPID_PUBLIC_KEY = savedPub;
    if (savedPriv !== undefined) process.env.WEB_PUSH_VAPID_PRIVATE_KEY = savedPriv;
    if (savedSa !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT_JSON = savedSa;
  }
});

test('/api/push/dispatch validates method, notificationId, and safely skips when server push env is unset', async () => {
  const methodMock = createMockRes();
  await dispatchHandler(
    { method: 'GET', headers: {} } as VercelLikeRequest,
    methodMock.res
  );
  assert.equal(methodMock.getStatus(), 405);

  const badIdMock = createMockRes();
  await dispatchHandler(
    {
      method: 'POST',
      headers: {},
      body: { notificationId: 'invalid/path/id' },
    } as VercelLikeRequest,
    badIdMock.res
  );
  assert.equal(badIdMock.getStatus(), 400);

  const savedSa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  try {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const skipMock = createMockRes();
    await dispatchHandler(
      {
        method: 'POST',
        headers: {},
        body: { notificationId: 'cmt_valid_123' },
      } as VercelLikeRequest,
      skipMock.res
    );
    assert.equal(skipMock.getStatus(), 200);
    assert.equal(skipMock.getBody().configured, false);
    assert.equal(skipMock.getBody().skipped, true);
  } finally {
    if (savedSa !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT_JSON = savedSa;
  }
});

test('/api/push/broadcast validates method, eventType whitelist, title requirement, and safe unconfigured skip', async () => {
  const methodMock = createMockRes();
  await broadcastHandler(
    { method: 'GET', headers: {} } as VercelLikeRequest,
    methodMock.res
  );
  assert.equal(methodMock.getStatus(), 405);

  const badEventMock = createMockRes();
  await broadcastHandler(
    {
      method: 'POST',
      headers: {},
      body: { eventType: 'arbitrary_event', title: 'Test' },
    } as VercelLikeRequest,
    badEventMock.res
  );
  assert.equal(badEventMock.getStatus(), 400);

  const emptyTitleMock = createMockRes();
  await broadcastHandler(
    {
      method: 'POST',
      headers: {},
      body: { eventType: 'announcement', title: '   ' },
    } as VercelLikeRequest,
    emptyTitleMock.res
  );
  assert.equal(emptyTitleMock.getStatus(), 400);

  const savedSa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  try {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const skipMock = createMockRes();
    await broadcastHandler(
      {
        method: 'POST',
        headers: {},
        body: {
          eventType: 'announcement',
          title: 'Campus Convocation Update',
          targetPath: '/?view=for-you',
        },
      } as VercelLikeRequest,
      skipMock.res
    );
    assert.equal(skipMock.getStatus(), 200);
    assert.equal(skipMock.getBody().configured, false);
    assert.equal(skipMock.getBody().skipped, true);
  } finally {
    if (savedSa !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT_JSON = savedSa;
  }
  const officialSkipMock = createMockRes();
  try {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    await broadcastHandler(
      {
        method: 'POST',
        headers: {},
        body: {
          eventType: 'official_update',
          title: 'Official Semester Calendar Notice',
          targetPath: '/?view=updates&postId=upd_1',
        },
      } as VercelLikeRequest,
      officialSkipMock.res
    );
    assert.equal(officialSkipMock.getStatus(), 200);
    assert.equal(officialSkipMock.getBody().skipped, true);
  } finally {
    if (savedSa !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT_JSON = savedSa;
  }
});

test('pushSanitizer defaults VAPID subject to lasuedintel@gmail.com, supports mention & official_update prefs, and constrains origin URLs', () => {
  assert.equal(normalizeVapidSubject(undefined), 'mailto:lasuedintel@gmail.com');
  assert.equal(isNotificationAllowedByRawPrefs('mention', { mentions: true }), true);
  assert.equal(isNotificationAllowedByRawPrefs('mention', { mentions: false }), false);
  assert.equal(isNotificationAllowedByRawPrefs('official_update', { announcements: true }), true);
  assert.equal(isNotificationAllowedByRawPrefs('official_update', { announcements: false }), false);

  const sanitized = sanitizePushPayloadForClient({
    notificationId: 'mnt_post1_user2',
    eventType: 'mention',
    title: 'You were mentioned in a campus post',
    body: '@adaobi check this update',
    targetPath: '/?view=for-you&postId=post1',
    unreadCount: 3,
    allowedOrigin: 'https://lasuedintel.com.ng',
  });
  assert.equal(sanitized.targetPath, '/?view=for-you&postId=post1');
  assert.equal(sanitized.isAnonymous, false);
});

test('shouldPrunePushFailure prunes expired/mismatched subscriptions and preserves transient rate-limit/5xx failures', () => {
  assert.equal(shouldPrunePushFailure({ statusCode: 404 }), true);
  assert.equal(shouldPrunePushFailure({ statusCode: 410 }), true);
  assert.equal(
    shouldPrunePushFailure({ statusCode: 400, body: 'NotRegistered' }),
    true
  );
  assert.equal(
    shouldPrunePushFailure({ statusCode: 403, body: 'MismatchSenderId' }),
    true
  );
  assert.equal(
    shouldPrunePushFailure({ statusCode: 403, body: 'VapidPkHashMismatch' }),
    true
  );

  assert.equal(shouldPrunePushFailure({ statusCode: 429 }), false);
  assert.equal(shouldPrunePushFailure({ statusCode: 500 }), false);
  assert.equal(shouldPrunePushFailure({ statusCode: 503 }), false);
  assert.equal(
    shouldPrunePushFailure({ statusCode: 403, body: 'Temporary forbidden' }),
    false
  );
});

test('/api/push/config exposes public key without secrets when configured, and dispatch/broadcast enforce auth', async () => {
  const savedPub = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const savedPriv = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const savedSa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  const vapidPair = webpush.generateVAPIDKeys();
  const validPub = vapidPair.publicKey;
  const validPriv = vapidPair.privateKey;
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pemKey = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const dummySa = JSON.stringify({
    project_id: 'lasued-intel',
    client_email: 'firebase-adminsdk@lasued-intel.iam.gserviceaccount.com',
    private_key: pemKey,
  });

  try {
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = validPub;
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = validPriv;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = dummySa;

    const cfgMock = createMockRes();
    await configHandler(
      { method: 'GET', headers: {} } as VercelLikeRequest,
      cfgMock.res
    );
    assert.equal(cfgMock.getStatus(), 200);
    assert.deepEqual(cfgMock.getBody(), {
      configured: true,
      vapidPublicKey: validPub,
    });
    assert.equal('vapidPrivateKey' in cfgMock.getBody(), false);

    const unauthDispatch = createMockRes();
    await dispatchHandler(
      {
        method: 'POST',
        headers: {},
        body: { notificationId: 'cmt_valid_123' },
      } as VercelLikeRequest,
      unauthDispatch.res
    );
    assert.equal(unauthDispatch.getStatus(), 401);

    const unauthBroadcast = createMockRes();
    await broadcastHandler(
      {
        method: 'POST',
        headers: {},
        body: {
          eventType: 'announcement',
          title: 'Campus Update',
        },
      } as VercelLikeRequest,
      unauthBroadcast.res
    );
    assert.equal(unauthBroadcast.getStatus(), 401);
  } finally {
    if (savedPub === undefined) delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
    else process.env.WEB_PUSH_VAPID_PUBLIC_KEY = savedPub;
    if (savedPriv === undefined) delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
    else process.env.WEB_PUSH_VAPID_PRIVATE_KEY = savedPriv;
    if (savedSa === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = savedSa;
  }
});

test('Vercel env helpers unquote values, parse escaped/base64 service accounts, normalize DB IDs, and /api/push/config?diagnostics=1 avoids exposing secrets', async () => {
  assert.equal(unquoteEnvValue('  "hello-world"  '), 'hello-world');
  assert.equal(unquoteEnvValue("  'single_quoted' "), 'single_quoted');
  assert.equal(normalizeVapidKey('"abc+def/ghi=="'), 'abc-def_ghi');

  assert.equal(resolveNormalizedFirestoreDatabaseId(undefined), '(default)');
  assert.equal(resolveNormalizedFirestoreDatabaseId(' "(default)" '), '(default)');
  assert.equal(resolveNormalizedFirestoreDatabaseId(' "custom-db" '), 'custom-db');

  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pemKey = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const rawSa = JSON.stringify({
    project_id: 'lasued-intel',
    client_email: 'firebase-adminsdk@lasued-intel.iam.gserviceaccount.com',
    private_key: pemKey,
  });

  // Double-quoted JSON string
  const parsedQuoted = parseServiceAccountJson(`"${rawSa.replace(/"/g, '\\"')}"`);
  assert.equal(parsedQuoted?.projectId, 'lasued-intel');

  // URL-safe base64 without padding
  const urlSafeB64 = Buffer.from(rawSa, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const parsedB64 = parseServiceAccountJson(urlSafeB64);
  assert.equal(parsedB64?.clientEmail, 'firebase-adminsdk@lasued-intel.iam.gserviceaccount.com');

  const savedPub = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const savedPriv = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const savedSa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const vapidPair = webpush.generateVAPIDKeys();
  try {
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = `"${vapidPair.publicKey}"`;
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = `"${vapidPair.privateKey}"`;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = urlSafeB64;

    const diagMock = createMockRes();
    await configHandler(
      { method: 'GET', url: '/api/push/config?diagnostics=1', headers: {} } as VercelLikeRequest,
      diagMock.res
    );
    assert.equal(diagMock.getStatus(), 200);
    const diagBody = diagMock.getBody();
    assert.equal(diagBody.configured, true);
    assert.equal(diagBody.vapidPublicKey, vapidPair.publicKey);
    const diagnostics = diagBody.diagnostics as Record<string, unknown>;
    assert.equal(diagnostics.vapidPublicKeyValid, true);
    assert.equal(diagnostics.vapidPrivateKeyValid, true);
    assert.equal(diagnostics.firebaseServiceAccountValid, true);
    assert.equal('privateKey' in diagnostics, false);
    assert.equal('vapidPrivateKey' in diagBody, false);
  } finally {
    if (savedPub === undefined) delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
    else process.env.WEB_PUSH_VAPID_PUBLIC_KEY = savedPub;
    if (savedPriv === undefined) delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
    else process.env.WEB_PUSH_VAPID_PRIVATE_KEY = savedPriv;
    if (savedSa === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = savedSa;
  }
});

test('all /api/**/*.ts serverless files use explicit .js extensions on relative imports for Vercel ESM compatibility', () => {
  const apiDir = path.resolve(process.cwd(), 'api');
  const collectTsFiles = (dir: string): string[] => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectTsFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        files.push(fullPath);
      }
    }
    return files;
  };

  const tsFiles = collectTsFiles(apiDir);
  assert.ok(tsFiles.length >= 8);
  const relativeImportRegex = /from\s+['"](\.[^'"]+)['"]/g;
  for (const filePath of tsFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    let match: RegExpExecArray | null;
    while ((match = relativeImportRegex.exec(content)) !== null) {
      assert.ok(
        match[1].endsWith('.js'),
        `${path.relative(process.cwd(), filePath)} has extensionless relative import: ${match[1]}`
      );
    }
  }
});

test('/api/push/test validates method, auth, clamping, and builds distinct stackable tags', async () => {
  const methodMock = createMockRes();
  await testHandler(
    { method: 'GET', headers: {} } as VercelLikeRequest,
    methodMock.res
  );
  assert.equal(methodMock.getStatus(), 405);

  const savedSa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  try {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const unconfigMock = createMockRes();
    await testHandler(
      {
        method: 'POST',
        headers: {},
        body: { count: 3, delaySeconds: 6 },
      } as VercelLikeRequest,
      unconfigMock.res
    );
    assert.equal(unconfigMock.getStatus(), 200);
    assert.equal(unconfigMock.getBody().configured, false);
    assert.equal(unconfigMock.getBody().skipped, true);
  } finally {
    if (savedSa !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT_JSON = savedSa;
  }

  assert.deepEqual(clampTestPushOptions({ count: 99, delaySeconds: 20 }), {
    count: 3,
    delaySeconds: 6,
  });
  assert.deepEqual(clampTestPushOptions({ count: 0, delaySeconds: -5 }), {
    count: 1,
    delaySeconds: 0,
  });

  const stack = buildTestPushPayloads({
    batchId: 'abc123',
    count: 3,
    allowedOrigin: 'https://lasuedintel.com.ng',
  });
  assert.equal(stack.length, 3);
  assert.deepEqual(
    stack.map((item) => item.tag),
    ['test_abc123_1', 'test_abc123_2', 'test_abc123_3']
  );

  const savedPub = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const savedPriv = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const vapidPair = webpush.generateVAPIDKeys();
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pemKey = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  try {
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = vapidPair.publicKey;
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = vapidPair.privateKey;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      project_id: 'lasued-intel',
      client_email: 'firebase-adminsdk@lasued-intel.iam.gserviceaccount.com',
      private_key: pemKey,
    });

    const unauthMock = createMockRes();
    await testHandler(
      {
        method: 'POST',
        headers: {},
        body: { count: 3, delaySeconds: 6 },
      } as VercelLikeRequest,
      unauthMock.res
    );
    assert.equal(unauthMock.getStatus(), 401);
  } finally {
    if (savedPub === undefined) delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
    else process.env.WEB_PUSH_VAPID_PUBLIC_KEY = savedPub;
    if (savedPriv === undefined) delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
    else process.env.WEB_PUSH_VAPID_PRIVATE_KEY = savedPriv;
    if (savedSa === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = savedSa;
  }
});

