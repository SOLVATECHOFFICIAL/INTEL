import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDeterministicPushSubscriptionId,
  detectDeviceEnvironment,
  evaluatePushCapabilities,
  formatUnreadBadgeCount,
  isValidHttpsPushEndpoint,
  isValidVapidPublicKey,
  parseNotificationTargetUrl,
  urlBase64ToUint8Array,
} from './pwa';
import {
  computeBroadcastDedupId,
  isNotificationAllowedByRawPrefs,
  normalizeVapidSubject,
  sanitizeInternalTargetPath,
  sanitizePushPayloadForClient,
  timingSafeSecretMatch,
} from '../../api/_lib/pushSanitizer';

test('formatUnreadBadgeCount formats 1-999 verbatim and 1000+ as 999+', () => {
  assert.equal(formatUnreadBadgeCount(0), null);
  assert.equal(formatUnreadBadgeCount(-5), null);
  assert.equal(formatUnreadBadgeCount(Number.NaN), null);
  assert.equal(formatUnreadBadgeCount(1), '1');
  assert.equal(formatUnreadBadgeCount(42.9), '42');
  assert.equal(formatUnreadBadgeCount(999), '999');
  assert.equal(formatUnreadBadgeCount(1000), '999+');
  assert.equal(formatUnreadBadgeCount(2450), '999+');
});

test('detectDeviceEnvironment and evaluatePushCapabilities distinguish iOS Safari vs Standalone iOS vs Android/Desktop', () => {
  const iosSafariEnv = detectDeviceEnvironment({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    matchMediaStandalone: false,
    navigatorStandalone: false,
    hasNotificationApi: false,
    hasServiceWorkerApi: true,
    hasPushManagerApi: false,
    isSecureContext: true,
  });
  assert.equal(iosSafariEnv.isIosOrIpadOs, true);
  assert.equal(iosSafariEnv.isStandalone, false);
  const iosSafariCap = evaluatePushCapabilities(iosSafariEnv);
  assert.equal(iosSafariCap.canShowEnableButton, false);
  assert.equal(iosSafariCap.isStandaloneRequiredOnIos, true);

  const iosStandaloneEnv = detectDeviceEnvironment({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    platform: 'iPhone',
    matchMediaStandalone: true,
    navigatorStandalone: true,
    hasNotificationApi: true,
    hasServiceWorkerApi: true,
    hasPushManagerApi: true,
    isSecureContext: true,
  });
  assert.equal(iosStandaloneEnv.isIosOrIpadOs, true);
  assert.equal(iosStandaloneEnv.isStandalone, true);
  const iosStandaloneCap = evaluatePushCapabilities(iosStandaloneEnv);
  assert.equal(iosStandaloneCap.canShowEnableButton, true);
  assert.equal(iosStandaloneCap.isStandaloneRequiredOnIos, false);

  const androidChromeEnv = detectDeviceEnvironment({
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36',
    platform: 'Linux armv8l',
    matchMediaStandalone: false,
    navigatorStandalone: false,
    hasNotificationApi: true,
    hasServiceWorkerApi: true,
    hasPushManagerApi: true,
    isSecureContext: true,
  });
  assert.equal(androidChromeEnv.isAndroid, true);
  assert.equal(androidChromeEnv.isIosOrIpadOs, false);
  assert.equal(evaluatePushCapabilities(androidChromeEnv).canShowEnableButton, true);

  const insecureEnv = detectDeviceEnvironment({
    userAgent: 'Mozilla/5.0 Chrome/123.0.0.0',
    hasNotificationApi: true,
    hasServiceWorkerApi: true,
    hasPushManagerApi: true,
    isSecureContext: false,
    origin: 'http://example.com',
  });
  assert.equal(evaluatePushCapabilities(insecureEnv).canShowEnableButton, false);
});

test('parseNotificationTargetUrl parses safe deep links and blocks unsafe or foreign URLs', () => {
  const origin = 'https://lasued-intel.vercel.app';

  const postNav = parseNotificationTargetUrl(
    '/?view=anonymous&postId=anon_1&commentId=cmt_2',
    origin
  );
  assert.ok(postNav);
  assert.equal(postNav.route, 'anonymous');
  assert.equal(postNav.destination.postId, 'anon_1');
  assert.equal(postNav.destination.commentId, 'cmt_2');

  const profileNav = parseNotificationTargetUrl(
    'https://lasued-intel.vercel.app/?view=profile&username=adaobi',
    origin
  );
  assert.ok(profileNav);
  assert.equal(profileNav.route, 'profile');
  assert.equal(profileNav.destination.username, 'adaobi');

  const mktNav = parseNotificationTargetUrl(
    '/?view=marketplace&listingId=lst_77',
    origin
  );
  assert.ok(mktNav);
  assert.equal(mktNav.route, 'marketplace');
  assert.equal(mktNav.destination.listingId, 'lst_77');

  assert.equal(parseNotificationTargetUrl('javascript:alert(1)', origin), null);
  assert.equal(parseNotificationTargetUrl('data:text/html,xss', origin), null);
  assert.equal(
    parseNotificationTargetUrl('https://evil.example/?view=for-you', origin),
    null
  );
});

test('VAPID and push subscription helpers validate formats and hash deterministically', async () => {
  const validKey = 'B' + 'A'.repeat(86);
  assert.equal(isValidVapidPublicKey(validKey), true);
  assert.equal(isValidVapidPublicKey('too-short'), false);
  assert.equal(urlBase64ToUint8Array('SGVsbG8').length, 5);

  assert.equal(
    isValidHttpsPushEndpoint('https://fcm.googleapis.com/fcm/send/abc123456789'),
    true
  );
  assert.equal(
    isValidHttpsPushEndpoint('http://insecure.example.com/push/1234567890'),
    false
  );

  const subIdA = await computeDeterministicPushSubscriptionId(
    'https://fcm.googleapis.com/fcm/send/endpoint-1'
  );
  const subIdB = await computeDeterministicPushSubscriptionId(
    'https://fcm.googleapis.com/fcm/send/endpoint-1'
  );
  const subIdC = await computeDeterministicPushSubscriptionId(
    'https://fcm.googleapis.com/fcm/send/endpoint-2'
  );
  assert.equal(subIdA, subIdB);
  assert.notEqual(subIdA, subIdC);
  assert.match(subIdA, /^sub_[a-f0-9]{16,64}$/);
});

test('server push sanitizer enforces anonymous safety, path sanitization, preferences, and timing-safe secret match', () => {
  const anonPayload = sanitizePushPayloadForClient({
    notificationId: 'anon_reply_cmt1',
    eventType: 'anonymous_reply',
    title: '',
    body: 'Someone   replied   to your thread',
    targetPath: 'https://evil.example/phish',
    unreadCount: 1200,
    allowedOrigin: 'https://lasued-intel.vercel.app',
  });
  assert.equal(anonPayload.isAnonymous, true);
  assert.equal(anonPayload.title, 'New reply in The Unfiltered');
  assert.equal(anonPayload.targetPath, '/?view=notifications');
  assert.equal(anonPayload.unreadCount, 1200);
  assert.equal('actorUid' in anonPayload, false);

  assert.equal(
    sanitizeInternalTargetPath('/?view=events&eventId=ev_99', 'https://lasued-intel.vercel.app'),
    '/?view=events&eventId=ev_99'
  );
  assert.equal(
    sanitizeInternalTargetPath('javascript:alert(1)', 'https://lasued-intel.vercel.app'),
    '/?view=notifications'
  );

  assert.equal(
    isNotificationAllowedByRawPrefs('anonymous_reply', { anonymous_replies: false }),
    false
  );
  assert.equal(
    isNotificationAllowedByRawPrefs('mention', { mentions: false }),
    false
  );
  assert.equal(
    isNotificationAllowedByRawPrefs('comment', { commentsAndReplies: false }),
    false
  );
  assert.equal(
    isNotificationAllowedByRawPrefs('new_event', { events: true }),
    true
  );

  assert.equal(normalizeVapidSubject('admin@lasued.edu.ng'), 'mailto:admin@lasued.edu.ng');
  assert.equal(normalizeVapidSubject(''), 'mailto:lasuedintel@gmail.com');
  assert.equal(normalizeVapidSubject('https://lasued-intel.vercel.app'), 'https://lasued-intel.vercel.app');

  assert.equal(timingSafeSecretMatch('secret-xyz', 'secret-xyz'), true);
  assert.equal(timingSafeSecretMatch('secret-xyz', 'secret-abc'), false);
  assert.equal(timingSafeSecretMatch('', 'secret-abc'), false);

  const dedup = computeBroadcastDedupId({
    eventType: 'announcement',
    title: 'Exam Timetable Released',
    targetPath: '/?view=for-you',
    firstNotificationId: 'ann_1',
  });
  assert.match(dedup, /^bcast_[a-f0-9]{32}$/);
});
