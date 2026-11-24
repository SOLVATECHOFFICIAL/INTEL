import { SectionDefinition } from '../types/platform';

export const PLATFORM_SECTIONS: readonly SectionDefinition[] = [
  {
    id: 'for-you',
    title: 'For You',
    shortTitle: 'For You',
    group: 'Feeds',
    summary:
      'Combined campus stream led by Official Updates and verified Campus Updates, woven with Anonymous discussions and discovery.',
    emptyTitle: 'No community updates yet',
    emptyDescription:
      'Verified campus updates and faculty notices will appear here once published.',
    errorTitle: 'Unable to load For You feed',
    errorDescription:
      'A connection or data-loading issue prevented this feed from displaying. Retry when ready.',
  },
  {
    id: 'following',
    title: 'Following',
    shortTitle: 'Following',
    group: 'Feeds',
    summary:
      'Direct updates from student organizations, campus contributors, and faculties you choose to follow.',
    emptyTitle: 'No followed updates yet',
    emptyDescription:
      'Updates from accounts and departments you follow will appear here.',
    errorTitle: 'Unable to load Following stream',
    errorDescription:
      'Could not retrieve updates for your followed campus channels. Please retry.',
  },
  {
    id: 'latest',
    title: 'Latest',
    shortTitle: 'Latest',
    group: 'Feeds',
    summary:
      'Chronological stream combining Official Updates, Campus Updates, and Anonymous discussions newest first.',
    emptyTitle: 'No campus updates published yet',
    emptyDescription:
      'The chronological campus feed is connected and ready. Published updates will appear here newest first.',
    errorTitle: 'Unable to refresh Latest updates',
    errorDescription:
      'The latest campus stream encountered an interruption. Use Retry to attempt loading again.',
  },
  {
    id: 'updates',
    title: 'Updates',
    shortTitle: 'Updates',
    group: 'Feeds',
    summary:
      'Official notices, verified campus advisories, and visual briefings published directly by LASUED Intel administration.',
    emptyTitle: 'No official updates yet',
    emptyDescription:
      'Verified administrative announcements and campus advisories will appear here once published.',
    errorTitle: 'Unable to load Updates',
    errorDescription:
      'Official updates could not be retrieved right now. Please retry.',
  },
  {
    id: 'anonymous',
    title: 'Anonymous',
    shortTitle: 'Anonymous',
    group: 'Feeds',
    summary:
      'Open anonymous campus perspectives and student discussions without displaying public author identities.',
    emptyTitle: 'No anonymous posts yet',
    emptyDescription:
      'Public anonymous campus posts will appear here without revealing author profiles or identities.',
    errorTitle: 'Unable to load Anonymous feed',
    errorDescription:
      'Anonymous discussions could not be fetched at the moment. Please try again.',
  },
  {
    id: 'marketplace',
    title: 'Marketplace',
    shortTitle: 'Marketplace',
    group: 'Campus Hub',
    summary:
      'Structured student-to-student space for textbooks, study tools, accommodation, and campus services.',
    emptyTitle: 'No marketplace listings yet',
    emptyDescription:
      'Approved student products, services, and accommodation listings will appear here.',
    errorTitle: 'Unable to load Marketplace',
    errorDescription:
      'Marketplace listings failed to load. Check your connection and retry.',
  },
  {
    id: 'trusted-circle',
    title: 'Trusted Circle',
    shortTitle: 'Trusted Circle',
    group: 'Campus Hub',
    summary:
      'Verified members, moderators, and administrator-listed lecturer and student representative contacts.',
    emptyTitle: 'No Trusted Circle entries listed yet',
    emptyDescription:
      'Verified campus accounts and administrator-listed lecturer or student representative contacts will appear here.',
    errorTitle: 'Unable to load Trusted Circle',
    errorDescription:
      'We could not retrieve Trusted Circle directory details. Please retry.',
  },
  {
    id: 'opportunities',
    title: 'Opportunities',
    shortTitle: 'Opportunities',
    group: 'Campus Hub',
    summary:
      'Scholarships, grants, internships, job openings, competitions, skill programmes, trainings, and conferences for LASUED students.',
    emptyTitle: 'No opportunities listed yet',
    emptyDescription:
      'Scholarships, grants, internships, fellowships, and campus career openings will appear here once published.',
    errorTitle: 'Unable to load Opportunities',
    errorDescription:
      'Opportunity listings could not be retrieved right now. Please try again.',
  },
  {
    id: 'upcoming-events',
    title: 'Events',
    shortTitle: 'Events',
    group: 'Campus Hub',
    summary:
      'Departmental programmes, faculty seminars, workshops, orientations, competitions, and campus activities.',
    emptyTitle: 'No campus events scheduled yet',
    emptyDescription:
      'Campus calendar items, academic dates, and student events will appear here once published.',
    errorTitle: 'Unable to load Events',
    errorDescription:
      'The campus events schedule could not be loaded. Retry to check again.',
  },
] as const;
