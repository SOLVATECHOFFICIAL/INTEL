import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDeterministicPushSubscriptionId,
  detectDeviceEnvironment,
  doVapidApplicationServerKeysMatch,
  evaluatePushCapabilities,
  formatUnreadBadgeCount,
  isValidHttpsPushEndpoint,
  isValidVapidPublicKey,
  normalizeIncomingPushPayload,
  parseNotificationTargetUrl,
  resolveWebPushUiStatus,
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
  const origin = 'https://lasuedintel.com.ng';

  const postNav = parseNotificationTargetUrl(
    '/?view=anonymous&postId=anon_1&commentId=cmt_2',
    origin
  );
  assert.ok(postNav);
  assert.equal(postNav.route, 'anonymous');
  assert.equal(postNav.destination.postId, 'anon_1');
  assert.equal(postNav.destination.commentId, 'cmt_2');

  const profileNav = parseNotificationTargetUrl(
    'https://lasuedintel.com.ng/?view=profile&username=adaobi',
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
    allowedOrigin: 'https://lasuedintel.com.ng',
  });
  assert.equal(anonPayload.isAnonymous, true);
  assert.equal(anonPayload.title, 'New reply in The Unfiltered');
  assert.equal(anonPayload.targetPath, '/?view=notifications');
  assert.equal(anonPayload.unreadCount, 1200);
  assert.equal('actorUid' in anonPayload, false);

  assert.equal(
    sanitizeInternalTargetPath('/?view=events&eventId=ev_99', 'https://lasuedintel.com.ng'),
    '/?view=events&eventId=ev_99'
  );
  assert.equal(
    sanitizeInternalTargetPath('javascript:alert(1)', 'https://lasuedintel.com.ng'),
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
  assert.equal(normalizeVapidSubject('https://lasuedintel.com.ng'), 'https://lasuedintel.com.ng');

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

test('doVapidApplicationServerKeysMatch detects matching vs rotated VAPID public keys', () => {
  const keyA = 'B' + 'A'.repeat(86);
  const keyB = 'B' + 'C'.repeat(86);
  const bytesA = urlBase64ToUint8Array(keyA);

  assert.equal(doVapidApplicationServerKeysMatch(bytesA, keyA), true);
  assert.equal(doVapidApplicationServerKeysMatch(bytesA.buffer, keyA), true);
  assert.equal(doVapidApplicationServerKeysMatch(bytesA, keyB), false);
  assert.equal(doVapidApplicationServerKeysMatch(null, keyA), false);
  assert.equal(doVapidApplicationServerKeysMatch(bytesA, 'short'), false);
});

test('normalizeIncomingPushPayload supports both LASUED flat payloads and FCM nested payloads safely', () => {
  const flatAnon = normalizeIncomingPushPayload(
    {
      notificationId: 'anon_reply_99',
      eventType: 'anonymous_reply',
      title: '',
      body: 'Someone replied in your thread',
      targetPath: '/?view=anonymous&postId=ap1&commentId=ac9',
      unreadCount: 4,
    },
    'https://lasuedintel.com.ng'
  );
  assert.equal(flatAnon.isAnonymous, true);
  assert.equal(flatAnon.title, 'New reply in The Unfiltered');
  assert.equal(
    flatAnon.targetPath,
    '/?view=anonymous&postId=ap1&commentId=ac9'
  );
  assert.equal(flatAnon.unreadCount, 4);

  const fcmPayload = normalizeIncomingPushPayload(
    {
      notification: {
        title: 'Official Senate Circular',
        body: 'Second semester timetable released.',
        tag: 'upd_44',
      },
      data: {
        eventType: 'official_update',
        notificationId: 'upd_44_user1',
        unreadCount: '7',
        link: 'https://lasuedintel.com.ng/?view=updates&postId=upd_44',
      },
    },
    'https://lasuedintel.com.ng'
  );
  assert.equal(fcmPayload.title, 'Official Senate Circular');
  assert.equal(fcmPayload.body, 'Second semester timetable released.');
  assert.equal(fcmPayload.targetPath, '/?view=updates&postId=upd_44');
  assert.equal(fcmPayload.unreadCount, 7);
  assert.equal(fcmPayload.tag, 'upd_44');
  assert.equal(fcmPayload.notificationId, 'upd_44_user1');

  const evilPayload = normalizeIncomingPushPayload(
    {
      notification: { title: 'Test' },
      fcmOptions: { link: 'https://evil.example/steal' },
    },
    'https://lasuedintel.com.ng'
  );
  assert.equal(evilPayload.targetPath, '/?view=notifications');
});

test('parseNotificationTargetUrl routes legacy events alias and all canonical views properly', () => {
  const origin = 'https://lasuedintel.com.ng';
  const legacyEventNav = parseNotificationTargetUrl(
    '/?view=events&eventId=ev_99',
    origin
  );
  assert.ok(legacyEventNav);
  assert.equal(legacyEventNav.route, 'upcoming-events');
  assert.equal(legacyEventNav.destination.eventId, 'ev_99');

  const postNav = parseNotificationTargetUrl(
    '/?view=for-you&postId=post_123',
    origin
  );
  assert.ok(postNav);
  assert.equal(postNav.route, 'for-you');
  assert.equal(postNav.destination.postId, 'post_123');
});

test('resolveWebPushUiStatus keeps notification settings visible until permission is granted and respects denied/iOS', () => {
  const supportedCap = evaluatePushCapabilities(
    detectDeviceEnvironment({
      userAgent: 'Mozilla/5.0 Chrome/124.0',
      hasNotificationApi: true,
      hasServiceWorkerApi: true,
      hasPushManagerApi: true,
      isSecureContext: true,
    })
  );
  const iosSafariCap = evaluatePushCapabilities(
    detectDeviceEnvironment({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)',
      platform: 'iPhone',
      matchMediaStandalone: false,
      navigatorStandalone: false,
      hasNotificationApi: false,
      hasServiceWorkerApi: true,
      hasPushManagerApi: false,
      isSecureContext: true,
    })
  );

  assert.equal(
    resolveWebPushUiStatus({
      isSignedIn: true,
      isSuspended: false,
      capability: supportedCap,
      permission: 'default',
      vapidConfigured: true,
      enabling: false,
      isSubscribedForUser: false,
    }),
    'ready_to_enable'
  );

  assert.equal(
    resolveWebPushUiStatus({
      isSignedIn: true,
      isSuspended: false,
      capability: supportedCap,
      permission: 'denied',
      vapidConfigured: true,
      enabling: false,
      isSubscribedForUser: false,
    }),
    'denied'
  );

  assert.equal(
    resolveWebPushUiStatus({
      isSignedIn: true,
      isSuspended: false,
      capability: iosSafariCap,
      permission: 'unsupported',
      vapidConfigured: false,
      enabling: false,
      isSubscribedForUser: false,
    }),
    'ios_install_required'
  );

  assert.equal(
    resolveWebPushUiStatus({
      isSignedIn: true,
      isSuspended: false,
      capability: supportedCap,
      permission: 'default',
      vapidConfigured: false,
      enabling: false,
      isSubscribedForUser: false,
    }),
    'ready_to_enable'
  );

  assert.equal(
    resolveWebPushUiStatus({
      isSignedIn: true,
      isSuspended: false,
      capability: supportedCap,
      permission: 'default',
      vapidConfigured: null,
      enabling: false,
      isSubscribedForUser: false,
    }),
    'ready_to_enable'
  );

  assert.equal(
    resolveWebPushUiStatus({
      isSignedIn: true,
      isSuspended: false,
      capability: supportedCap,
      permission: 'granted',
      vapidConfigured: false,
      enabling: false,
      isSubscribedForUser: false,
    }),
    'server_unconfigured'
  );

  const iosStandaloneCap = evaluatePushCapabilities(
    detectDeviceEnvironment({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)',
      platform: 'iPhone',
      matchMediaStandalone: true,
      navigatorStandalone: true,
      hasNotificationApi: true,
      hasServiceWorkerApi: true,
      hasPushManagerApi: true,
      isSecureContext: true,
    })
  );

  assert.equal(
    resolveWebPushUiStatus({
      isSignedIn: true,
      isSuspended: false,
      capability: iosStandaloneCap,
      permission: 'default',
      vapidConfigured: false,
      enabling: false,
      isSubscribedForUser: false,
    }),
    'ready_to_enable'
  );

  assert.equal(
    resolveWebPushUiStatus({
      isSignedIn: true,
      isSuspended: false,
      capability: supportedCap,
      permission: 'granted',
      vapidConfigured: true,
      enabling: false,
      isSubscribedForUser: true,
    }),
    'enabled'
  );
});

