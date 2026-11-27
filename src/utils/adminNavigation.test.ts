import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildAdminNavGroups,
  findGroupForAdminSection,
  resolveDefaultSectionForGroup,
} from './adminNavigation';

describe('adminNavigation two-tier groups', () => {
  it('groups all 10 sections cleanly into 4 groups for supreme_admin', () => {
    const groups = buildAdminNavGroups('supreme_admin', false);
    assert.deepEqual(
      groups.map((g) => g.id),
      ['overview', 'people', 'moderation', 'campus']
    );
    assert.deepEqual(
      groups.find((g) => g.id === 'people')?.sections.map((s) => s.id),
      ['members', 'badges', 'trusted-circle']
    );
    assert.deepEqual(
      groups.find((g) => g.id === 'moderation')?.sections.map((s) => s.id),
      ['marketplace', 'content']
    );
    assert.deepEqual(
      groups.find((g) => g.id === 'campus')?.sections.map((s) => s.id),
      ['opportunities', 'events', 'audit-log', 'settings']
    );
  });

  it('restricts moderators to Overview and Moderation only', () => {
    const groups = buildAdminNavGroups('moderator', false);
    assert.deepEqual(
      groups.map((g) => g.id),
      ['overview', 'moderation']
    );
    assert.deepEqual(
      groups[1]?.sections.map((s) => s.id),
      ['marketplace', 'content']
    );
  });

  it('returns empty groups for suspended staff or non-staff members', () => {
    assert.equal(buildAdminNavGroups('supreme_admin', true).length, 0);
    assert.equal(buildAdminNavGroups('member', false).length, 0);
    assert.equal(buildAdminNavGroups('verified', false).length, 0);
    assert.equal(buildAdminNavGroups('guest', false).length, 0);
  });

  it('finds matching parent group and default child section safely', () => {
    const groups = buildAdminNavGroups('supreme_admin', false);
    const matched = findGroupForAdminSection(groups, 'badges');
    assert.equal(matched?.id, 'people');
    assert.equal(resolveDefaultSectionForGroup(matched), 'members');

    const modGroups = buildAdminNavGroups('moderator', false);
    const fallback = findGroupForAdminSection(modGroups, 'settings');
    assert.equal(fallback?.id, 'overview');
  });
});
