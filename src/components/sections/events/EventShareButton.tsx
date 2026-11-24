import React from 'react';
import type { CampusEvent } from '../../../types/database';
import { buildEventShareUrl, formatEventDateTimeRange } from '../../../utils/events';
import { ShareActionMenu } from '../../shared/ShareActionMenu';

interface EventShareButtonProps {
  event: Pick<CampusEvent, 'id' | 'title' | 'venue' | 'eventDate' | 'endDate' | 'timeLabel'>;
}

export const EventShareButton: React.FC<EventShareButtonProps> = ({ event }) => {
  const shareUrl = buildEventShareUrl(event.id);
  const shareText = `${event.title} · ${formatEventDateTimeRange(event)} at ${event.venue}`;

  return (
    <ShareActionMenu
      shareUrl={shareUrl}
      title={event.title}
      text={shareText}
      variant="icon"
      align="right"
      ariaLabel={`Share ${event.title}`}
      buttonClassName="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#0B1A2E]"
      testId={`event-share-btn-${event.id}`}
    />
  );
};
