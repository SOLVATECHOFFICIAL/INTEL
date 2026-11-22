export type SectionId =
  | 'for-you'
  | 'following'
  | 'latest'
  | 'anonymous'
  | 'marketplace'
  | 'trusted-circle'
  | 'opportunities'
  | 'upcoming-events';

export type FeedTabId = 'for-you' | 'following' | 'latest';

export type SearchScopeId =
  | 'home'
  | 'anonymous'
  | 'marketplace'
  | 'trusted-circle'
  | 'opportunities'
  | 'upcoming-events';

export type UtilityRouteId =
  | 'notifications'
  | 'search'
  | 'account'
  | 'profile'
  | 'admin'
  | 'login'
  | 'register';

export type ActiveRoute = SectionId | UtilityRouteId;

export type ProfileTab =
  | 'posts'
  | 'saved'
  | 'liked'
  | 'anonymous'
  | 'listings'
  | 'followers'
  | 'following';

export type ViewState = 'empty' | 'loading' | 'error';

export type SectionGroup = 'Feeds' | 'Campus Hub';

export interface SectionDefinition {
  id: SectionId;
  title: string;
  shortTitle: string;
  group: SectionGroup;
  summary: string;
  emptyTitle: string;
  emptyDescription: string;
  errorTitle: string;
  errorDescription: string;
}
