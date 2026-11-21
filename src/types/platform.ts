export type SectionId =
  | 'for-you'
  | 'following'
  | 'latest'
  | 'the-unfiltered'
  | 'marketplace'
  | 'trusted-circle'
  | 'opportunities'
  | 'upcoming-events';

export type ActiveRoute = 'overview' | SectionId;

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
