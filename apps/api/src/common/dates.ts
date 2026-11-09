/** Shop-local calendar helpers (default Asia/Colombo, UTC+05:30, no DST). */

export function localDateKey(d: Date, timeZone = 'Asia/Colombo'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function isSameLocalDay(a: Date, b: Date, timeZone = 'Asia/Colombo'): boolean {
  return localDateKey(a, timeZone) === localDateKey(b, timeZone);
}

/** UTC instant of local midnight for the given local date (YYYY-MM-DD). */
export function localDayStart(dateKey: string, timeZone = 'Asia/Colombo'): Date {
  const guess = new Date(`${dateKey}T00:00:00Z`);
  const offsetMin = tzOffsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offsetMin * 60_000);
}

function tzOffsetMinutes(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - d.getTime()) / 60_000);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}
