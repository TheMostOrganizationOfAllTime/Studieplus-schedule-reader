// Turns lessons into text for the terminal.

import { WEEKDAYS, MONTHS, hhmm, isoWeek, pad2 } from "./dates.ts";
import type { Day, Lesson } from "./Types.ts";

function clip(text: string, short: boolean): string {
  return short && text.length > 140
    ? text.slice(0, 140).trimEnd() + "..."
    : text;
}

/** "08:15-09:15  L1  Biologi B          D2221            lsv            24vfcbiB" */
export function formatLesson(l: Lesson): string {
  const title = l.title || "?";
  const rooms = l.rooms.join("-") || "?";
  const teachers = l.teachers.join(", ") || "-";
  return `${hhmm(l.start)}-${hhmm(l.end)}  L${l.index ?? "?"}  ${title.padEnd(18)} ${rooms.padEnd(16)} ${teachers.padEnd(14)} ${l.classes.join(", ")}`.trimEnd();
}

export function formatWeek(monday: Date, days: Day[], short = false): string {
  const lines = [
    "",
    `=== Week of ${pad2(monday.getDate())} ${MONTHS[monday.getMonth()]} ${monday.getFullYear()} (ISO week ${isoWeek(monday)}) ===`,
  ];
  for (const { date, lessons } of days) {
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    if (weekend && lessons.length === 0) continue;
    lines.push(
      `${WEEKDAYS[date.getDay()]} ${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}${lessons.length ? "" : " - no lessons"}`,
    );
    for (const lesson of lessons) {
      lines.push("   " + formatLesson(lesson));
      const extras: [string, string][] = [
        ["Remark", lesson.remark],
        ["Homework", lesson.homework],
        ["Note", lesson.note],
      ];
      for (const [label, value] of extras) {
        if (!value) continue;
        const [first, ...rest] = clip(value, short).split("\n");
        lines.push(`        ${(label + ":").padEnd(10)}${first}`);
        for (const line of rest) lines.push(line ? " ".repeat(18) + line : "");
      }
    }
  }
  return lines.join("\n");
}
