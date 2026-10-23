// Small date helpers. All dates are local wall-clock time (Studie+ sends school-local times).

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Add days to a date, keeping it at local midnight. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Local midnight of the given moment. */
export function startOfDayOf(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The Monday of the week containing `date`, at local midnight. */
export function mondayOf(date: Date): Date {
  const daysSinceMonday = (date.getDay() + 6) % 7;
  return addDays(date, -daysSinceMonday);
}

/** "2026-10-26" */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Parses "YYYY-MM-DD" as a local date. Returns null if it is not a real date. */
export function parseIsoDate(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dateKey(date) === text ? date : null;
}

/** ISO 8601 week number (weeks start on Monday, week 1 contains January 4th). */
export function isoWeek(date: Date): number {
  const thursday = addDays(date, 3 - ((date.getDay() + 6) % 7));
  const week1Monday = mondayOf(new Date(thursday.getFullYear(), 0, 4));
  const days = Math.round(
    (mondayOf(thursday).getTime() - week1Monday.getTime()) / 86_400_000,
  );
  return 1 + Math.round(days / 7);
}

/** "08:15" */
export const hhmm = (date: Date): string =>
  `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
