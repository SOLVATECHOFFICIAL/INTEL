/**
 * Trusted Server-Side Administrative Architecture Contract
 *
 * IMPORTANT:
 * Project `lasued-intel` enforces all RBAC, Designated Two-Admin protection, PII isolation,
 *
 * Therefore:
 * - No live `firebase-admin` IAM code or service account keys exist in this repository.
 * - All RBAC, Designated Two-Admin protection, PII isolation, and anonymous identity isolation
 *   are enforced server-side by Cloud Firestore Security Rules (`firestore.rules`).
 * - This module defines the clean TypeScript contracts ready for future Cloud Functions
 *   or Node Admin SDK endpoints if/when the owner upgrades the project.
 */

import type { BadgeType, UserRole } from '../types/database';

export type ServerAdminDeploymentMode =
  | 'starter_tier_rules_enforced'
  | 'user_owned_admin_sdk_ready';

export const ADMIN_ARCHITECTURE_MODE: ServerAdminDeploymentMode =
  'starter_tier_rules_enforced';

export interface CustomClaimsSyncRequest {
  callerUid: string;
  targetUid: string;
  nextRole: UserRole;
  nextBadge: BadgeType;
}

export interface CascadeDeleteAnonymousPostRequest {
  callerUid: string;
  postId: string;
}

export interface CascadeDeleteResult {
  deletedPostId: string;
  deletedCommentsCount: number;
  deletedReactionsCount: number;
  deletedIdentityMappingsCount: number;
}

export interface RevealAnonymousAuthorRequest {
  callerUid: string;
  entryId: string;
  entryType: 'anonymousPosts' | 'anonymousComments';
  reason: string;
}

export interface RevealAnonymousAuthorResponse {
  entryId: string;
  authorUid: string;
  authorRole: UserRole;
  auditLogId: string;
}

export interface RecommendationJobSummary {
  userId: string;
  computedAtIso: string;
  candidatePostIds: string[];
}
