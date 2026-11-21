import { SectionDefinition } from '../types/platform';

export const PLATFORM_SECTIONS: readonly SectionDefinition[] = [
  {
    id: 'for-you',
    title: 'For You',
    shortTitle: 'For You',
    group: 'Feeds',
    summary:
      'Tailored campus updates, faculty notices, and relevant student threads organized for your academic focus.',
    emptyTitle: 'Personalized feed will appear here',
    emptyDescription:
      'This section is prepared for personalized campus updates once student accounts and feed preferences are connected.',
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
    emptyTitle: 'No followed sources connected yet',
    emptyDescription:
      'Updates from departments, verified student clubs, and contributors you follow will be listed here in a later phase.',
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
      'Chronological stream of campus briefings, academic updates, and verified community posts.',
    emptyTitle: 'No campus updates published yet',
    emptyDescription:
      'The chronological campus feed is structured and ready. Verified briefings will populate here once live data is connected.',
    errorTitle: 'Unable to refresh Latest updates',
    errorDescription:
      'The latest campus stream encountered an interruption. Use Retry to attempt loading again.',
  },
  {
    id: 'the-unfiltered',
    title: 'The Unfiltered',
    shortTitle: 'Unfiltered',
    group: 'Feeds',
    summary:
      'Open student perspectives, constructive campus dialogue, and shared experiences across campus life.',
    emptyTitle: 'No community discussions yet',
    emptyDescription:
      'Student commentary and campus discussions will live here once moderation and publishing workflows are enabled.',
    errorTitle: 'Unable to load The Unfiltered',
    errorDescription:
      'Community discussions could not be fetched at the moment. Please try again.',
  },
  {
    id: 'marketplace',
    title: 'Marketplace',
    shortTitle: 'Market',
    group: 'Campus Hub',
    summary:
      'Structured student-to-student space for textbooks, study tools, electronics, and campus essentials.',
    emptyTitle: 'Marketplace listings are not connected yet',
    emptyDescription:
      'Product categories and verified student listings will appear here once marketplace persistence is integrated.',
    errorTitle: 'Unable to load Marketplace',
    errorDescription:
      'Marketplace listings failed to load. Check your connection and retry.',
  },
  {
    id: 'trusted-circle',
    title: 'Trusted Circle',
    shortTitle: 'Circle',
    group: 'Campus Hub',
    summary:
      'Verified peer recommendations, study circles, and accountable student community connections.',
    emptyTitle: 'Trusted Circle is awaiting verification setup',
    emptyDescription:
      'Peer-verified groups, study networks, and trusted campus contacts will appear here in the next development phase.',
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
      'Scholarships, internships, SIWES openings, fellowships, and student leadership roles.',
    emptyTitle: 'No opportunities listed yet',
    emptyDescription:
      'Verified internships, scholarships, and campus career openings will be published here once the opportunity board is connected.',
    errorTitle: 'Unable to load Opportunities',
    errorDescription:
      'Opportunity listings could not be retrieved right now. Please try again.',
  },
  {
    id: 'upcoming-events',
    title: 'Upcoming Events',
    shortTitle: 'Events',
    group: 'Campus Hub',
    summary:
      'Academic calendar milestones, faculty seminars, workshops, and recognized campus gatherings.',
    emptyTitle: 'No upcoming events scheduled yet',
    emptyDescription:
      'Campus calendar items, academic dates, and student events will appear here once event scheduling is wired.',
    errorTitle: 'Unable to load Upcoming Events',
    errorDescription:
      'The campus events schedule could not be loaded. Retry to check again.',
  },
] as const;
