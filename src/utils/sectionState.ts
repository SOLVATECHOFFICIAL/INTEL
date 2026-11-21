import { PLATFORM_SECTIONS } from '../config/sections';
import {
  SectionDefinition,
  SectionGroup,
  SectionId,
  ViewState,
} from '../types/platform';

export function getSectionById(id: SectionId): SectionDefinition {
  const found = PLATFORM_SECTIONS.find((section) => section.id === id);
  return found ?? PLATFORM_SECTIONS[0];
}

export function getSectionsByGroup(
  group: SectionGroup
): readonly SectionDefinition[] {
  return PLATFORM_SECTIONS.filter((section) => section.group === group);
}

export function createInitialSectionStates(
  initialState: ViewState = 'empty'
): Record<SectionId, ViewState> {
  return PLATFORM_SECTIONS.reduce(
    (acc, section) => {
      acc[section.id] = initialState;
      return acc;
    },
    {} as Record<SectionId, ViewState>
  );
}

export function transitionViewState(
  current: ViewState,
  action: 'SET_LOADING' | 'SET_EMPTY' | 'SET_ERROR' | 'RETRY'
): ViewState {
  switch (action) {
    case 'SET_LOADING':
      return 'loading';
    case 'SET_EMPTY':
      return 'empty';
    case 'SET_ERROR':
      return 'error';
    case 'RETRY':
      return current === 'error' ? 'loading' : current;
  }
}
