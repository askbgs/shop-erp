import { isSameLocalDay, localDateKey, localDayStart } from '../src/common/dates';

describe('shop-local dates (Asia/Colombo)', () => {
  it('midnight in Colombo is 18:30 UTC the day before', () => {
    expect(localDayStart('2026-11-09').toISOString()).toBe('2026-11-08T18:30:00.000Z');
  });
  it('day boundaries follow local time', () => {
    expect(localDateKey(new Date('2026-11-08T18:29:00Z'))).toBe('2026-11-08');
    expect(localDateKey(new Date('2026-11-08T18:31:00Z'))).toBe('2026-11-09');
    expect(isSameLocalDay(new Date('2026-11-08T19:00:00Z'), new Date('2026-11-09T18:00:00Z'))).toBe(true);
  });
});
