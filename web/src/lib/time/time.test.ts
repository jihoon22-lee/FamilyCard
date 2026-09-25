import { describe, expect, it } from 'vitest';
import { currentKstMonth, monthRange, kstDayStart, kstLocalDateTime } from './index';
describe('KST boundaries', () => {
  it('uses half-open calendar months across leap years and year end', () => {
    expect(monthRange('2024-02')).toEqual({
      start: new Date('2024-01-31T15:00:00Z'),
      end: new Date('2024-02-29T15:00:00Z'),
    });
    expect(monthRange('2026-12').end.toISOString()).toBe('2026-12-31T15:00:00.000Z');
    expect(currentKstMonth(new Date('2026-08-31T15:00:00Z'))).toBe('2026-09');
    expect(kstLocalDateTime('2026-09-01T00:01').toISOString()).toBe('2026-08-31T15:01:00.000Z');
  });
  it('rejects invalid days and times instead of rolling over', () => {
    for (const value of ['2026-02-29', '2026-13-01', '2026-00-01'])
      expect(() => kstDayStart(value)).toThrow();
    for (const value of ['2026-09-01T24:00', '2026-09-01T12:60'])
      expect(() => kstLocalDateTime(value)).toThrow();
  });
});
