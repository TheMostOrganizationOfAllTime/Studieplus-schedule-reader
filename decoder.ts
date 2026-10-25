// Decodes a Studie+ "skemaservice" response (GWT-RPC) into Lesson objects.
//
// The response looks like  //OK[ ...numbers..., ["string table"...], 0, 7 ]
// The numbers are a data stream stored in reverse. Every string is a 1-based index into the table,
// so a lesson is found by looking for known patterns of numbers and looking the strings up.
// Everything in a lesson below is described in "file order" (the writer's order is the reverse).

import { addDays, dateKey } from "./dates.ts";
import { Lesson, ScheduleError, type Day, type Room } from "./types.ts";

/** Booking-type lessons carry two strings: a TYPE (Elevmøde, Eksamen, Forberedelse...) and a TITLE
 *  (a free text, or the subject for exams). For these types the TITLE is shown as the subject and the
 *  TYPE as the remark. For every other type it is the other way around. */
const EXAM_TYPES = new Set(["Eksamen", "Forberedelse"]);

/** One date = minute,hour,day,month(0-based),year-1900,<2 refs>. A lesson holds two in a row (start,
 *  end); the back-references force the end to share day/month/year with the start. */
const LESSON_RE =
  /(?<![\d-])(\d+),(\d+),(\d+),(\d+),(1\d\d),(\d+),(\d+),0,(\d+),(\d+),\3,\4,\5,\6,\7(?!\d)/g;

/** GWT splits strings longer than 65535 characters into pieces joined with "+", so one table entry is
 *  "part1"+"part2"+... The table may also be empty. */
const STR = String.raw`"(?:[^"\\]|\\.)*"`;
const ITEM = `${STR}(?:\\+${STR})*`;
const TABLE_RE = new RegExp(
  String.raw`,\[((?:${ITEM}(?:,${ITEM})*)?)\],\d+,\d+\]\s*$`,
);
const ITEM_RE = new RegExp(ITEM, "gs");
const PART_RE = new RegExp(STR, "gs");

// ------------------------------------------------------------------ string table

function unescapeGwt(text: string): string {
  return text.replace(
    /\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/gs,
    (_, e: string) => {
      if (e.length > 1) return String.fromCharCode(parseInt(e.slice(1), 16));
      switch (e) {
        case "n":
          return "\n";
        case "t":
          return "\t";
        case "r":
          return "\r";
        case "b":
          return "\b";
        case "f":
          return "\f";
        case "0":
          return "\0";
        default:
          return e; // \\ \" \/
      }
    },
  );
}

function readStringTable(text: string): string[] {
  const match = TABLE_RE.exec(text);
  if (!match)
    throw new ScheduleError(
      "Could not find the string table at the end of the response.",
    );
  return [...match[1].matchAll(ITEM_RE)].map((item) =>
    [...item[0].matchAll(PART_RE)]
      .map((part) => unescapeGwt(part[0].slice(1, -1)))
      .join(""),
  );
}

/** Notes are sent as HTML (and a flattened plain version). Rebuild readable text with line breaks. */
export function htmlToText(source: string): string {
  const text = source
    .replace(/\s+/g, " ")
    .replace(/<br\s*\/?>|<\/div>|<\/p>|<\/li>|<\/h\d>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&amp;/g, "&");
  const lines = text
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim());
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ------------------------------------------------------------------ regex helpers

/** 1-based index of the first table entry starting with `prefix` (how the data stream refers to it). */
function indexOfClass(table: string[], prefix: string): number | null {
  const i = table.findIndex((s) => s.startsWith(prefix));
  return i === -1 ? null : i + 1;
}

/** Builds a regex from a table index, or null if that class is not in this response. */
function build(
  index: number | null,
  make: (n: number) => string,
  flags = "g",
): RegExp | null {
  return index === null ? null : new RegExp(make(index), flags);
}

/** Runs a "g" regex from `from` onward, or a "y" regex exactly at `from`. */
function execFrom(re: RegExp, text: string, from = 0): RegExpExecArray | null {
  re.lastIndex = from;
  return re.exec(text);
}

function makeDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date | null {
  const date = new Date(year, month, day, hour, minute);
  const ok =
    date.getMonth() === month &&
    date.getDate() === day &&
    date.getHours() === hour &&
    date.getMinutes() === minute;
  return ok ? date : null;
}

// ------------------------------------------------------------------ decoding

/** Turns a raw response into a flat list of lessons, sorted by time. */
export function decodeLessons(text: string): Lesson[] {
  if (!text.startsWith("//OK")) {
    throw new ScheduleError(
      "Server did not return a schedule:\n  " + text.slice(0, 300),
    );
  }
  const table = readStringTable(text);
  const str = (ref: string | number): string => table[Number(ref) - 1] ?? ""; // "" for null/empty

  const med = indexOfClass(
    table,
    "dk.uddata.model.skema.SkemaBegivenhed$MedarbejderISkema",
  );
  const lok = indexOfClass(
    table,
    "dk.uddata.model.skema.SkemaBegivenhed$LokalerISkema",
  );
  const akt = indexOfClass(
    table,
    "dk.uddata.model.skema.SkemaBegivenhed$AktiviteterISkema",
  );
  const arr = indexOfClass(table, "java.util.ArrayList");
  const int = indexOfClass(table, "java.lang.Integer");
  const noteClass = indexOfClass(
    table,
    "dk.uddata.model.skemanoter.SkemaNote2",
  );

  // --- notes and homework, keyed by event id. One record, in file order:
  //     notePlain, noteHtml, hwPlain, hwHtml, flag, x, y, z, <SkemaNote2>, eventId, <Integer>
  const notes = new Map<number, { note: string; homework: string }>();
  if (noteClass !== null && int !== null) {
    const noteRe = new RegExp(
      String.raw`(?<![\d-])(\d+),(\d+),(\d+),(\d+),[01],\d+,\d+,\d+,${noteClass},(\d+),${int}(?!\d)`,
      "g",
    );
    const best = (plain: string, html: string) =>
      htmlToText(str(html)) || str(plain).trim();
    for (const m of text.matchAll(noteRe)) {
      notes.set(Number(m[5]), {
        note: best(m[1], m[2]),
        homework: best(m[3], m[4]),
      });
    }
  }

  // --- patterns inside one lesson's data
  const teacherRe = build(
    med,
    (n) => String.raw`(?<![\d-])\d+,(\d+),\d+,${n}(?!\d)`,
  );
  const roomRe = build(
    lok,
    (n) => String.raw`(?<![\d-])\d+,(\d+),\d+,${n}(?!\d)`,
  );
  // lesson number + subject:  <count>,<ArrayList>,<lessonNo>,0,<subject>,0,0,0
  const coreRe = build(arr, (n) => String.raw`,\d+,${n},(\d),0,(\d+),0,0,0,`);
  // level (A/B/C):  ...,0,0,<id>,<Integer>,<level>,0,
  const levelRe = build(int, (n) => String.raw`,0,0,\d+,${n},(\d+),0,`);
  // remark = the string right before the first "group" entry; the token before the remark is the booking
  // type (0 for normal lessons). A group entry is:
  //   <0 or -1>,<name>,<HOLD|STAM|OVAK>,<id>,<x>,<AktiviteterISkema>
  const remarkRe = build(
    akt,
    (n) => String.raw`,(\d+),-?\d+,\d+,\d+,\d+,\d+,${n},`,
  );
  const chainRe = build(
    akt,
    (n) => String.raw`(?:,-?\d+,\d+,\d+,\d+,\d+,${n})+`,
    "y",
  );
  const entryRe = build(akt, (n) => String.raw`,-?\d+,(\d+),\d+,\d+,\d+,${n}`);
  const idRe = build(int, (n) => String.raw`,\d+,${n},(\d+),${n},`);
  const id7Re = build(int, (n) => String.raw`(?<![\d-])(\d{7,}),${n}(?!\d)`);

  const matches = [...text.matchAll(LESSON_RE)];
  const lessons: Lesson[] = [];
  const seen = new Set<string>();

  matches.forEach((m, n) => {
    const [minute, hour, day, month, year, minute2, hour2] = [
      m[1],
      m[2],
      m[3],
      m[4],
      m[5],
      m[8],
      m[9],
    ].map(Number);
    const start = makeDate(1900 + year, month, day, hour, minute);
    const end = makeDate(1900 + year, month, day, hour2, minute2);
    if (!start || !end || start >= end) return;

    // The data of this lesson runs until the next lesson's dates begin.
    const segStart = (m.index ?? 0) + m[0].length;
    const segEnd =
      n + 1 < matches.length
        ? (matches[n + 1].index ?? text.length)
        : text.length;
    const seg = text.slice(segStart, segEnd);

    const idMatch =
      (idRe && execFrom(idRe, seg)) || (id7Re && execFrom(id7Re, seg)) || null;
    const eventId = idMatch ? Number(idMatch[1]) : null;
    const key = `${start.getTime()}|${end.getTime()}|${eventId}`;
    if (seen.has(key)) return;
    seen.add(key);

    const lesson = new Lesson(start, end);
    lesson.eventId = eventId;

    const levelMatch = levelRe && execFrom(levelRe, seg);
    if (levelMatch && /^[A-Z]$/.test(str(levelMatch[1])))
      lesson.level = str(levelMatch[1]);

    const core = coreRe && execFrom(coreRe, seg);
    let after = 0; // where to continue searching in `seg`
    if (core) {
      after = core.index + core[0].length;
      lesson.index = Number(core[1]);
      lesson.subject = str(core[2]).trim();
      // The writer's order is the reverse of the file order, so reverse to get display order.
      const region = seg.slice(0, after);
      if (teacherRe)
        lesson.teachers = [...region.matchAll(teacherRe)]
          .map((t) => str(t[1]))
          .reverse();
      if (roomRe)
        lesson.rooms = [...region.matchAll(roomRe)]
          .map((r) => str(r[1]))
          .reverse();
    }

    const remarkMatch = remarkRe && execFrom(remarkRe, seg, after);
    if (remarkMatch) {
      const remarkStart = remarkMatch.index + 1; // skip the leading comma
      const remarkEnd = remarkStart + remarkMatch[1].length;
      lesson.remark = str(remarkMatch[1]).trim();

      // Student groups ("Class"): the chain of group entries that follows the remark.
      const chain = chainRe && execFrom(chainRe, seg, remarkEnd);
      if (chain && entryRe) {
        const names = [...chain[0].matchAll(entryRe)]
          .map((e) => str(e[1]))
          .reverse();
        lesson.classes = names.filter((name) => name && !name.startsWith("*")); // skip *BOOKING
      }

      if (!lesson.subject) {
        const before = seg.slice(0, remarkStart - 1);
        const prev = before.slice(before.lastIndexOf(",") + 1);
        const bookingType = /^\d+$/.test(prev) ? str(prev).trim() : "";
        const title = lesson.remark;
        if (EXAM_TYPES.has(bookingType)) {
          lesson.subject = title || bookingType;
          lesson.remark = bookingType;
          if (!lesson.level) {
            const split = /^(.*?)\s+([A-Z])$/.exec(lesson.subject.trim()); // "Kemi B" -> "Kemi" + "B"
            if (split) [, lesson.subject, lesson.level] = split;
          }
        } else if (bookingType) {
          lesson.subject = bookingType;
          lesson.remark = title;
        }
      }
    }

    const extra = eventId === null ? undefined : notes.get(eventId);
    if (extra) {
      lesson.homework = extra.homework;
      lesson.note = extra.note;
    }
    lessons.push(lesson);
  });

  return lessons.sort(
    (a, b) =>
      a.start.getTime() - b.start.getTime() ||
      a.end.getTime() - b.end.getTime(),
  );
}

/** Reads the room info from a room schedule response (hentLokaSkemaData). Null if there is none.
 *  The room record, in file order:
 *    <label>,<capacity?>,0,"",<name>,<description>,"",<id>,0,<name>,0,<Lokale>,<id>,<Integer> */
export function decodeRoom(text: string): Room | null {
  if (!text.startsWith("//OK")) return null;
  const table = readStringTable(text);
  const lokale = indexOfClass(table, "dk.uddata.model.skema.Lokale/");
  const int = indexOfClass(table, "java.lang.Integer");
  if (lokale === null || int === null) return null;
  const re = new RegExp(
    String.raw`(?<![\d-])\d+,\d+,\d+,\d+,(\d+),(\d+),\d+,(\d+),0,(\d+),0,${lokale},\d+,${int}(?!\d)`,
  );
  const m = re.exec(text);
  if (!m) return null;
  const str = (ref: string) => table[Number(ref) - 1]?.trim() || null;
  // The name appears twice in the record; some rooms (e.g. "Virtuel T1") only have it in the first slot.
  return {
    id: Number(m[3]),
    name: str(m[1]) ?? str(m[4]),
    description: str(m[2]),
  };
}

/** Groups a response into days.
 *  With `monday`: exactly Mon..Sun of that week (empty days included, other weeks ignored).
 *  Without: only the days that have lessons. */
export function parseSchedule(text: string, monday?: Date): Day[] {
  const byDay = new Map<string, Lesson[]>();
  for (const lesson of decodeLessons(text)) {
    const key = dateKey(lesson.start);
    byDay.set(key, [...(byDay.get(key) ?? []), lesson]);
  }
  if (monday) {
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(monday, i);
      return { date, lessons: byDay.get(dateKey(date)) ?? [] };
    });
  }
  return [...byDay.keys()].sort().map((key) => {
    const lessons = byDay.get(key)!;
    return {
      date: new Date(
        lessons[0].start.getFullYear(),
        lessons[0].start.getMonth(),
        lessons[0].start.getDate(),
      ),
      lessons,
    };
  });
}
