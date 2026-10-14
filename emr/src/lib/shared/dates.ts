// Calendar dates (date of birth, visit date, follow-up...) are stored as UTC
// midnight of that day, so they never shift with time zones. "Today", though,
// is the clinic's day: the hub's local clock, not UTC. In Guatemala (UTC-6) the
// UTC date already reads tomorrow from 6 pm, which made evening forms default
// to tomorrow and refuse a follow-up for today.

/** Today on this machine's clock, as YYYY-MM-DD. */
export function localDay(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Today as a stored calendar date (UTC midnight of the local day). */
export function localDayAsDate(now: Date = new Date()): Date {
  return new Date(`${localDay(now)}T00:00:00Z`);
}
