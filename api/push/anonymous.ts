import crypto from 'node:crypto';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
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

type AnonymousPushAction = 'comment' | 'post_like' | 'comment_like';

function sanitizeIdPart(raw: string, maxLen: number): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, maxLen);
}

function summarizeExcerpt(raw: unknown, maxLen = 140): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (!collapsed) return undefined;
  if (collapsed.length <= maxLen) return collapsed;
  return `${collapsed.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

function hashActorUid(actorUid: string): string {
  return crypto.createHash('sha256').update(actorUid, 'utf8').digest('hex').slice(0, 16);
}

async function resolveAnonymousMappingAuthorUid(
  db: Firestore,
  entryId: string | undefined
): Promise<string | null> {
  if (!entryId || !isValidFirestoreId(entryId)) return null;
  const snap = await db
    .collection('anonymousIdentityMappings')
    .doc(entryId)
    .get()
    .catch(() => null);
  const authorUid = snap?.exists ? snap.data()?.authorUid : null;
  return typeof authorUid === 'string' && isValidFirestoreId(authorUid)
    ? authorUid
    : null;
}

async function createAndDeliverAnonymousNotification(
  db: Firestore,
  input: {
    notifId: string;
    recipientUid: string;
    eventType: 'anonymous_reply' | 'anonymous_reaction';
    title: string;
    body?: string;
    targetPath: string;
    allowedOrigin: string;
  }
): Promise<{ sent: boolean; deduplicated: boolean }> {
  if (!isValidFirestoreId(input.notifId) || !isValidFirestoreId(input.recipientUid)) {
    return { sent: false, deduplicated: false };
  }

  const dedupClaimed = await claimPushDedupLock(
    db,
    `notif_${input.notifId.slice(0, 118)}`
  );
  if (!dedupClaimed) {
    return { sent: false, deduplicated: true };
  }

  const notifRef = db.collection('notifications').doc(input.notifId);
  const existingSnap = await notifRef.get().catch(() => null);
  if (!existingSnap?.exists) {
    await notifRef.set({
      id: input.notifId,
      recipientUid: input.recipientUid,
      eventType: input.eventType,
      title: input.title.slice(0, 160),
      ...(input.body ? { body: input.body.slice(0, 500) } : {}),
      targetPath: input.targetPath.slice(0, 256),
      isRead: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  const summary = await deliverWebPushToRecipient(db, {
    recipientUid: input.recipientUid,
    notificationId: input.notifId,
    eventType: input.eventType,
    title: input.title,
    body: input.body,
    targetPath: input.targetPath,
    allowedOrigin: input.allowedOrigin,
  });

  return {
    sent: summary.delivered > 0 || summary.attempted > 0,
    deduplicated: false,
  };
}

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const body = await readJsonBody(req);
  if (!body || typeof body.action !== 'string') {
    sendJson(res, 400, { error: 'A valid anonymous push action is required.' });
    return;
  }

  const action = body.action as AnonymousPushAction;
  if (action !== 'comment' && action !== 'post_like' && action !== 'comment_like') {
    sendJson(res, 400, { error: 'Unsupported anonymous push action.' });
    return;
  }

  const postId = typeof body.postId === 'string' ? body.postId : '';
  const commentId = typeof body.commentId === 'string' ? body.commentId : '';
  const parentCommentId =
    typeof body.parentCommentId === 'string' && isValidFirestoreId(body.parentCommentId)
      ? body.parentCommentId
      : undefined;
  const replyToCommentId =
    typeof body.replyToCommentId === 'string' && isValidFirestoreId(body.replyToCommentId)
      ? body.replyToCommentId
      : undefined;

  if (action === 'comment' && (!isValidFirestoreId(postId) || !isValidFirestoreId(commentId))) {
    sendJson(res, 400, { error: 'Valid postId and commentId are required.' });
    return;
  }
  if (action === 'post_like' && !isValidFirestoreId(postId)) {
    sendJson(res, 400, { error: 'A valid postId is required.' });
    return;
  }
  if (action === 'comment_like' && !isValidFirestoreId(commentId)) {
    sendJson(res, 400, { error: 'A valid commentId is required.' });
    return;
  }

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

  const db = clients.db;

  if (action === 'comment') {
    const commentSnap = await db.collection('anonymousComments').doc(commentId).get();
    if (!commentSnap.exists || commentSnap.data()?.status !== 'published') {
      sendJson(res, 404, { error: 'Anonymous comment not found.' });
      return;
    }

    const commentAuthorUid = await resolveAnonymousMappingAuthorUid(db, commentId);
    if (caller.kind === 'user' && commentAuthorUid !== caller.uid) {
      sendJson(res, 403, { error: 'Not authorized for this anonymous comment.' });
      return;
    }

    const actorUid = commentAuthorUid ?? (caller.kind === 'user' ? caller.uid : '');
    const commentData = commentSnap.data() ?? {};
    const effectivePostId =
      typeof commentData.postId === 'string' && isValidFirestoreId(commentData.postId)
        ? commentData.postId
        : postId;
    const effectiveParentId =
      typeof commentData.parentCommentId === 'string' &&
      isValidFirestoreId(commentData.parentCommentId)
        ? commentData.parentCommentId
        : parentCommentId;
    const effectiveReplyToId =
      typeof commentData.replyToCommentId === 'string' &&
      isValidFirestoreId(commentData.replyToCommentId)
        ? commentData.replyToCommentId
        : replyToCommentId;

    const [replyToOwnerUid, parentOwnerUid, postOwnerUid] = await Promise.all([
      resolveAnonymousMappingAuthorUid(db, effectiveReplyToId),
      effectiveParentId && effectiveParentId !== effectiveReplyToId
        ? resolveAnonymousMappingAuthorUid(db, effectiveParentId)
        : Promise.resolve(null),
      resolveAnonymousMappingAuthorUid(db, effectivePostId),
    ]);

    const excerpt = summarizeExcerpt(commentData.body, 140);
    const targetPath = `/?view=anonymous&postId=${effectivePostId}&commentId=${commentId}`;
    const deliveredTo = new Set<string>();
    const tasks: Array<Promise<{ sent: boolean; deduplicated: boolean }>> = [];

    const directReplyUid =
      replyToOwnerUid && replyToOwnerUid !== actorUid ? replyToOwnerUid : null;
    if (directReplyUid) {
      deliveredTo.add(directReplyUid);
      tasks.push(
        createAndDeliverAnonymousNotification(db, {
          notifId: `anon_reply_${sanitizeIdPart(commentId, 110)}`,
          recipientUid: directReplyUid,
          eventType: 'anonymous_reply',
          title: 'Someone replied to your anonymous comment',
          body: excerpt,
          targetPath,
          allowedOrigin: config.allowedOrigin,
        })
      );
    }

    if (
      parentOwnerUid &&
      parentOwnerUid !== actorUid &&
      !deliveredTo.has(parentOwnerUid)
    ) {
      deliveredTo.add(parentOwnerUid);
      tasks.push(
        createAndDeliverAnonymousNotification(db, {
          notifId: directReplyUid
            ? `anon_reply_${sanitizeIdPart(commentId, 90)}_root`
            : `anon_reply_${sanitizeIdPart(commentId, 110)}`,
          recipientUid: parentOwnerUid,
          eventType: 'anonymous_reply',
          title: directReplyUid
            ? 'New reply in your anonymous comment thread'
            : 'Someone replied to your anonymous comment',
          body: excerpt,
          targetPath,
          allowedOrigin: config.allowedOrigin,
        })
      );
    }

    if (
      postOwnerUid &&
      postOwnerUid !== actorUid &&
      !deliveredTo.has(postOwnerUid)
    ) {
      deliveredTo.add(postOwnerUid);
      tasks.push(
        createAndDeliverAnonymousNotification(db, {
          notifId:
            deliveredTo.size > 1
              ? `anon_reply_${sanitizeIdPart(commentId, 90)}_post`
              : `anon_reply_${sanitizeIdPart(commentId, 110)}`,
          recipientUid: postOwnerUid,
          eventType: 'anonymous_reply',
          title: effectiveParentId
            ? 'New reply on your anonymous post'
            : 'New comment on your anonymous post',
          body: excerpt,
          targetPath,
          allowedOrigin: config.allowedOrigin,
        })
      );
    }

    await Promise.allSettled(tasks);
    sendJson(res, 200, { ok: true, notifiedRecipients: deliveredTo.size });
    return;
  }

  if (caller.kind !== 'user') {
    sendJson(res, 403, { error: 'User authentication is required for anonymous reactions.' });
    return;
  }

  if (action === 'post_like') {
    const reactionId = `anonymousPosts_${postId}_${caller.uid}`;
    const [reactionSnap, postSnap, postOwnerUid] = await Promise.all([
      db.collection('postReactions').doc(reactionId).get().catch(() => null),
      db.collection('anonymousPosts').doc(postId).get().catch(() => null),
      resolveAnonymousMappingAuthorUid(db, postId),
    ]);

    if (!reactionSnap?.exists || !postSnap?.exists || postSnap.data()?.status !== 'published') {
      sendJson(res, 200, { ok: true, notifiedRecipients: 0 });
      return;
    }
    if (!postOwnerUid || postOwnerUid === caller.uid) {
      sendJson(res, 200, { ok: true, notifiedRecipients: 0 });
      return;
    }

    const notifId = `anon_rx_p_${sanitizeIdPart(postId, 44)}_${hashActorUid(caller.uid)}`;
    const excerpt = summarizeExcerpt(postSnap.data()?.body, 120);
    await createAndDeliverAnonymousNotification(db, {
      notifId,
      recipientUid: postOwnerUid,
      eventType: 'anonymous_reaction',
      title: 'Someone liked your anonymous post',
      body: excerpt,
      targetPath: `/?view=anonymous&postId=${postId}`,
      allowedOrigin: config.allowedOrigin,
    });

    sendJson(res, 200, { ok: true, notifiedRecipients: 1 });
    return;
  }

  // action === 'comment_like'
  const reactionId = `anonymousComments_${commentId}_${caller.uid}`;
  const [reactionSnap, commentSnap, commentOwnerUid] = await Promise.all([
    db.collection('postReactions').doc(reactionId).get().catch(() => null),
    db.collection('anonymousComments').doc(commentId).get().catch(() => null),
    resolveAnonymousMappingAuthorUid(db, commentId),
  ]);

  if (!reactionSnap?.exists || !commentSnap?.exists || commentSnap.data()?.status !== 'published') {
    sendJson(res, 200, { ok: true, notifiedRecipients: 0 });
    return;
  }
  if (!commentOwnerUid || commentOwnerUid === caller.uid) {
    sendJson(res, 200, { ok: true, notifiedRecipients: 0 });
    return;
  }

  const commentData = commentSnap.data() ?? {};
  const targetPostId =
    typeof commentData.postId === 'string' && isValidFirestoreId(commentData.postId)
      ? commentData.postId
      : postId;
  const notifId = `anon_rx_c_${sanitizeIdPart(commentId, 44)}_${hashActorUid(caller.uid)}`;
  const excerpt = summarizeExcerpt(commentData.body, 120);
  const targetPath = isValidFirestoreId(targetPostId)
    ? `/?view=anonymous&postId=${targetPostId}&commentId=${commentId}`
    : '/?view=anonymous';

  await createAndDeliverAnonymousNotification(db, {
    notifId,
    recipientUid: commentOwnerUid,
    eventType: 'anonymous_reaction',
    title: 'Someone liked your anonymous comment',
    body: excerpt,
    targetPath,
    allowedOrigin: config.allowedOrigin,
  });

  sendJson(res, 200, { ok: true, notifiedRecipients: 1 });
}
