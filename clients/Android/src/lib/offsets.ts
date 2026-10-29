export type Offset =
  | { kind: "before"; minutes: number }
  | { kind: "at"; time: string };

export const encodeOffset = (o: Offset): string =>
  o.kind === "before" ? `before:${o.minutes}` : `at:${o.time}`;

export function parseOffset(s: string): Offset | null {
  const [kind, ...rest] = s.split(":");
  const v = rest.join(":");
  if (kind === "before" && /^\d+$/.test(v)) return { kind, minutes: Number(v) };
  if (kind === "at" && /^\d{2}:\d{2}$/.test(v)) return { kind, time: v };
  return null;
}

export function describeOffset(s: string): string {
  const o = parseOffset(s);
  if (!o) return s;
  return o.kind === "before"
    ? `wake ${o.minutes} min before`
    : `wake at ${o.time}`;
}

export function describeCondition(key: string): string {
  const [from, to] = key.split("-");
  return to ? `First lesson ${from}–${to}` : `First lesson at ${from}`;
}
