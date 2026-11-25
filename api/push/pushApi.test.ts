import test from 'node:test';
import assert from 'node:assert/strict';
import configHandler from './config';
import dispatchHandler from './dispatch';
import broadcastHandler from './broadcast';
import {
  isNotificationAllowedByRawPrefs,
  normalizeVapidSubject,
  sanitizePushPayloadForClient,
} from '../_lib/pushSanitizer';
import type { VercelLikeRequest, VercelLikeResponse } from '../_lib/pushServer';

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
