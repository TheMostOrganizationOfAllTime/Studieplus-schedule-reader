const pad = (n: number) => String(n).padStart(2, "0");

export const minutesToHhmm = (m: number) =>
  `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export const dateToHhmm = (d: Date) =>
  `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function hhmmToDate(s: string): Date {
  const [h, m] = s.split(":").map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d;
}
