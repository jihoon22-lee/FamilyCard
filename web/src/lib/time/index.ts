const KST = 9 * 3600000;
export function kstDayStart(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('날짜 형식을 확인해주세요.');
  const y = Number(match[1]),
    m = Number(match[2]),
    d = Number(match[3]);
  if (
    y < 1970 ||
    y > 9998 ||
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > new Date(Date.UTC(y, m, 0)).getUTCDate()
  )
    throw new Error('올바른 날짜를 입력해주세요.');
  return new Date(Date.UTC(y, m - 1, d) - KST);
}
export function kstLocalDateTime(value: string): Date {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] ?? 0) > 59)
    throw new Error('한국 시간 기준 시각을 확인해주세요.');
  return new Date(
    kstDayStart(match[1]!).getTime() +
      Number(match[2]) * 3600000 +
      Number(match[3]) * 60000 +
      Number(match[4] ?? 0) * 1000,
  );
}
export function monthRange(value: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error('월 형식을 확인해주세요.');
  const start = kstDayStart(value + '-01');
  const local = new Date(start.getTime() + KST);
  return {
    start,
    end: new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - KST),
  };
}
export function currentKstMonth(now = new Date()): string {
  return new Date(now.getTime() + KST).toISOString().slice(0, 7);
}
export function dateTimeInput(date: Date): string {
  return new Date(date.getTime() + KST).toISOString().slice(0, 16);
}
export function dayInput(date: Date | null): string {
  return date ? new Date(date.getTime() + KST).toISOString().slice(0, 10) : '';
}
const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  dateStyle: 'short',
  timeStyle: 'short',
});
export function formatDate(date: Date): string {
  return dateFormatter.format(date);
}
