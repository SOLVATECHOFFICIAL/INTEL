import React from 'react';
import {
  Briefcase,
  Calendar,
  Compass,
  Clock,
  MessageSquare,
  ShieldCheck,
  ShoppingBag,
  Users,
} from 'lucide-react';
import { SectionId } from '../types/platform';

interface SectionIconProps {
  sectionId: SectionId;
  className?: string;
}

export const SectionIcon: React.FC<SectionIconProps> = ({
  sectionId,
  className = 'h-4 w-4',
}) => {
  switch (sectionId) {
    case 'for-you':
      return <Compass className={className} aria-hidden="true" />;
    case 'following':
      return <Users className={className} aria-hidden="true" />;
    case 'latest':
      return <Clock className={className} aria-hidden="true" />;
    case 'the-unfiltered':
      return <MessageSquare className={className} aria-hidden="true" />;
    case 'marketplace':
      return <ShoppingBag className={className} aria-hidden="true" />;
    case 'trusted-circle':
      return <ShieldCheck className={className} aria-hidden="true" />;
    case 'opportunities':
      return <Briefcase className={className} aria-hidden="true" />;
    case 'upcoming-events':
      return <Calendar className={className} aria-hidden="true" />;
  }
};
