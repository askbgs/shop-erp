import { canTransition, DELIVERABLE, REPAIR_TRANSITIONS } from '../src/modules/repairs/repair-workflow';

describe('repair workflow', () => {
  it('follows the happy path', () => {
    const path = ['RECEIVED', 'DIAGNOSING', 'WAITING_APPROVAL', 'IN_REPAIR', 'QUALITY_CHECK', 'READY'] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBe(true);
  });
  it('blocks jumps and reopening', () => {
    expect(canTransition('RECEIVED', 'READY')).toBe(false);
    expect(canTransition('DELIVERED', 'IN_REPAIR')).toBe(false);
  });
  it('never reaches DELIVERED by a plain status change', () => {
    for (const to of Object.values(REPAIR_TRANSITIONS)) expect(to).not.toContain('DELIVERED');
  });
  it('lets declined and unrepairable devices be handed back', () => {
    expect(DELIVERABLE).toEqual(expect.arrayContaining(['READY', 'REJECTED', 'NOT_REPAIRABLE']));
  });
});
