#!/usr/bin/env node
/**
 * Fetch and decode your Studie+ schedule.
 * npm start -- --help to see the command options
 *
 * Examples (run with a TypeScript runner such as `npx tsx skema_fetch.ts`):
 *   skema_fetch.ts                    # this week only (one network call)
 *   skema_fetch.ts --weeks 4          # this week + the next 3 (one call per week)
 *   skema_fetch.ts --from 2026-11-09  # start at the week containing that date
 *   skema_fetch.ts --raw              # also save raw_<date>.txt responses
 *   skema_fetch.ts --short            # clip long notes/homework to 140 characters
 *   skema_fetch.ts --file resp.txt    # decode a saved response (no network)
 *
 * Cookies go in config.json next to this file. See README_SETUP.md.
 *
 * Importable API:
 *   const cfg = await loadConfig();
 *   const days = await getWeek(cfg, monday); // Day[]; each Day has a date and lessons
 */

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const HERE = __dirname;
const BASE = "https://all.uddataplus.dk/skema/skema/";
const URL = `${BASE}skemaservice`;
const DEFAULT_STRONG = "0E790BF304400AEF7F91A082938908F3";
const UDATE_TYPE = "dk.uddata.gwt.comm.shared.UDate/2314285719";
const SERVICE = "dk.uddata.services.interfaces.SkemaService";

// Booking types for which the title is treated as the subject and the type as the remark.
const EXAM_TYPES = new Set(["Eksamen", "Forberedelse"]);

export interface Config {
  instnr: string;
  utoken: string;
  strong_name?: unknown;
  permutation?: unknown;
  [key: string]: unknown;
}

export interface Lesson {
  start: Date;
  end: Date;
  index: number | null;
  subject: string;
  level: string;
  rooms: string[];
  teachers: string[];
  classes: string[];
  note: string;
  homework: string;
  remark: string;
  event_id: number | null;
  /** Subject with level, e.g. "Biologi B". */
  readonly title: string;
}

export interface Day {
  date: Date;
  lessons: Lesson[];
}

class CliError extends Error {}

function makeLesson(start: Date, end: Date, eventId: number | null): Lesson {
  const lesson: Lesson = {
    start,
    end,
    index: null,
    subject: "",
    level: "",
    rooms: [],
    teachers: [],
    classes: [],
    note: "",
    homework: "",
    remark: "",
    event_id: eventId,
    get title(): string {
      return `${this.subject} ${this.level}`.trim();
    },
  };
  return lesson;
}

// ---------------------------------------------------------------- config / request
export async function loadConfig(): Promise<Config> {
  const configPath = join(HERE, "config.json");
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new CliError(`Missing ${configPath} - see README_SETUP.md`);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(
      `config.json is not valid JSON (${detail}). Keep the quotes around every value.`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliError("config.json must contain a JSON object.");
  }

  const cfg = parsed as Record<string, unknown>;
  for (const key of ["instnr", "utoken"] as const) {
    const value = String(cfg[key] ?? "").trim();
    if (!value || value.startsWith("PASTE")) {
      throw new CliError(
        `config.json: "${key}" is not filled in - see README_SETUP.md`,
      );
    }
    cfg[key] = value;
  }
  return cfg as Config;
}

/** RPC body for hentEgnePersSkemaData(UDate from, UDate to). */
export function buildBody(cfg: Config, start: Date, end: Date): string {
  const strong = String(cfg.strong_name || DEFAULT_STRONG);
  const ud = (d: Date): string =>
    `5|6|${d.getFullYear() - 1900}|${d.getMonth()}|${d.getDate()}|0|0|0|`;
  return `7|0|6|${BASE}|${strong}|${SERVICE}|hentEgnePersSkemaData|${UDATE_TYPE}|UDate:|1|2|3|4|2|5|5|${ud(start)}${ud(end)}`;
}

export async function fetchWeekText(
  cfg: Config,
  monday: Date,
): Promise<string> {
  const sunday = addDays(monday, 6);
  const headers: Record<string, string> = {
    "Content-Type": "text/x-gwt-rpc; charset=UTF-8",
    "X-GWT-Module-Base": BASE,
    Cookie: `instnr=${cfg.instnr}; utoken=${cfg.utoken}`,
  };
  if (cfg.permutation) headers["X-GWT-Permutation"] = String(cfg.permutation);

  const response = await fetch(URL, {
    method: "POST",
    headers,
    body: buildBody(cfg, monday, sunday),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new CliError(
      `HTTP ${response.status} from server. 401/403 = cookies expired or wrong; 500 = strong name changed (see README_SETUP.md).`,
    );
  }
  return response.text();
}

export async function getWeek(
  cfg: Config,
  monday: Date,
  saveRaw = false,
): Promise<Day[]> {
  const text = await fetchWeekText(cfg, monday);
  if (saveRaw) {
    await writeFile(join(HERE, `raw_${dateKey(monday)}.txt`), text, "utf8");
  }
  return parseSchedule(text, monday);
}

// ---------------------------------------------------------------- decoding
const TABLE_RE =
  /,\[("(?:[^"\\]|\\.)*"(?:,"(?:[^"\\]|\\.)*")*)\],\d+,\d+\]\s*$/;
const LESSON_RE =
  /(?<![\d-])(\d+),(\d+),(\d+),(\d+),(1\d\d),(\d+),(\d+),0,(\d+),(\d+),\3,\4,\5,\6,\7(?!\d)/g;

interface FoundMatch {
  match: RegExpExecArray;
  index: number;
}

/** Execute a non-global expression starting at an offset, retaining the absolute match index. */
function findFrom(re: RegExp, text: string, from = 0): FoundMatch | null {
  const match = re.exec(text.slice(from));
  return match ? { match, index: from + match.index } : null;
}

function allMatches(re: RegExp, text: string): RegExpExecArray[] {
  const global = new RegExp(
    re.source,
    re.flags.includes("g") ? re.flags : `${re.flags}g`,
  );
  return Array.from(text.matchAll(global));
}

function stringTable(text: string): string[] {
  const match = TABLE_RE.exec(text);
  if (!match) return [];
  try {
    return JSON.parse(`[${match[1]}]`) as string[];
  } catch {
    return [];
  }
}

/** Decode common HTML entities without requiring an external package. */
function unescapeHtml(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: "\u00a0",
    aelig: "æ",
    AElig: "Æ",
    oslash: "ø",
    Oslash: "Ø",
    aring: "å",
    Aring: "Å",
    ae: "æ",
    AE: "Æ",
    szlig: "ß",
    copy: "©",
    reg: "®",
    trade: "™",
    hellip: "…",
    ndash: "–",
    mdash: "—",
    lsquo: "‘",
    rsquo: "’",
    ldquo: "“",
    rdquo: "”",
    bull: "•",
    euro: "€",
    pound: "£",
    yen: "¥",
    cent: "¢",
    sect: "§",
    para: "¶",
    middot: "·",
    times: "×",
    divide: "÷",
    plusmn: "±",
    deg: "°",
    micro: "µ",
    not: "¬",
    sup2: "²",
    sup3: "³",
    frac12: "½",
    frac14: "¼",
    frac34: "¾",
    acute: "´",
    cedil: "¸",
    uml: "¨",
    tilde: "˜",
    laquo: "«",
    raquo: "»",
  };
  return text.replace(
    /&(#(?:x[\da-f]+|\d+)|[a-z][a-z\d]+);?/gi,
    (entity, body: string) => {
      if (body.startsWith("#")) {
        const isHex = /^#x/i.test(body);
        const value = Number.parseInt(
          body.slice(isHex ? 2 : 1),
          isHex ? 16 : 10,
        );
        if (
          !Number.isFinite(value) ||
          value <= 0 ||
          value > 0x10ffff ||
          (value >= 0xd800 && value <= 0xdfff)
        ) {
          return "\uFFFD";
        }
        try {
          return String.fromCodePoint(value);
        } catch {
          return "\uFFFD";
        }
      }
      return Object.prototype.hasOwnProperty.call(named, body)
        ? named[body]
        : entity;
    },
  );
}

export function htmlToText(input: string): string {
  let text = input.replace(/\s+/g, " ");
  text = text.replace(/<br\s*\/?>|<\/div>|<\/p>|<\/li>|<\/h\d>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = unescapeHtml(text);
  const lines = text
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim());
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLevel(name: string): [string, string] {
  const trimmed = name.trim();
  const match = /^(.*?)\s+([A-Z])$/.exec(trimmed);
  return match ? [match[1], match[2]] : [trimmed, ""];
}

export function decodeLessons(text: string): Lesson[] {
  if (!text.startsWith("//OK")) {
    throw new CliError(
      `Server did not return a schedule:\n  ${text.slice(0, 300)}`,
    );
  }
  const table = stringTable(text);

  // Indices in the GWT string table are one-based.
  const idx = (prefix: string): number | null => {
    const index = table.findIndex((value) => value.startsWith(prefix));
    return index < 0 ? null : index + 1;
  };
  const s = (value: string | number | undefined): string => {
    const index = Number(value);
    return Number.isInteger(index) && index > 0 && index <= table.length
      ? table[index - 1]
      : "";
  };

  const med = idx("dk.uddata.model.skema.SkemaBegivenhed$MedarbejderISkema");
  const lok = idx("dk.uddata.model.skema.SkemaBegivenhed$LokalerISkema");
  const akt = idx("dk.uddata.model.skema.SkemaBegivenhed$AktiviteterISkema");
  const arr = idx("java.util.ArrayList");
  const integer = idx("java.lang.Integer");
  const noteClass = idx("dk.uddata.model.skemanoter.SkemaNote2");

  // Note record fields: notePlain, noteHtml, hwPlain, hwHtml, flag, x, y, z,
  // SkemaNote2, eventId, Integer.
  const notes = new Map<number, { note: string; homework: string }>();
  if (noteClass !== null && integer !== null) {
    const noteRe = new RegExp(
      `(?<![\\d-])(\\d+),(\\d+),(\\d+),(\\d+),[01],\\d+,\\d+,\\d+,${noteClass},(\\d+),${integer}(?!\\d)`,
      "g",
    );
    const best = (plain: string, html: string): string =>
      htmlToText(s(html)) || s(plain).trim();
    for (const match of text.matchAll(noteRe)) {
      const [, notePlain, noteHtml, hwPlain, hwHtml, eventId] = match;
      notes.set(Number(eventId), {
        note: best(notePlain, noteHtml),
        homework: best(hwPlain, hwHtml),
      });
    }
  }

  // Patterns inside an individual lesson's segment.
  const teacherRe =
    med !== null
      ? new RegExp(`(?<![\\d-])\\d+,(\\d+),\\d+,${med}(?!\\d)`)
      : null;
  const roomRe =
    lok !== null
      ? new RegExp(`(?<![\\d-])\\d+,(\\d+),\\d+,${lok}(?!\\d)`)
      : null;
  const coreRe =
    arr !== null ? new RegExp(`,\\d+,${arr},(\\d),0,(\\d+),0,0,0,`) : null;
  const levelRe =
    integer !== null ? new RegExp(`,0,0,\\d+,${integer},(\\d+),0,`) : null;
  const remarkRe =
    akt !== null ? new RegExp(`,(\\d+),0,\\d+,\\d+,\\d+,\\d+,${akt},`) : null;
  const remarkOldRe =
    arr !== null ? new RegExp(`,${arr},0,0,0,0,(\\d+),0,`) : null;
  const chainRe =
    akt !== null ? new RegExp(`(?:,0,\\d+,\\d+,\\d+,\\d+,${akt})+`) : null;
  const entryRe =
    akt !== null ? new RegExp(`,0,(\\d+),\\d+,\\d+,\\d+,${akt}`, "g") : null;
  const idRe =
    integer !== null ? new RegExp(`,\\d+,${integer},(\\d+),${integer},`) : null;
  const id7Re =
    integer !== null
      ? new RegExp(`(?<![\\d-])(\\d{7,}),${integer}(?!\\d)`)
      : null;

  const matches = allMatches(LESSON_RE, text);
  const out: Lesson[] = [];
  const seen = new Set<string>();

  for (let n = 0; n < matches.length; n += 1) {
    const match = matches[n];
    const minute = Number(match[1]);
    const hour = Number(match[2]);
    const day = Number(match[3]);
    const monthZeroBased = Number(match[4]);
    const year = 1900 + Number(match[5]);
    const minute2 = Number(match[8]);
    const hour2 = Number(match[9]);

    const start = new Date(year, monthZeroBased, day, hour, minute, 0, 0);
    const end = new Date(year, monthZeroBased, day, hour2, minute2, 0, 0);
    if (
      start.getFullYear() !== year ||
      start.getMonth() !== monthZeroBased ||
      start.getDate() !== day ||
      start.getHours() !== hour ||
      start.getMinutes() !== minute ||
      end.getFullYear() !== year ||
      end.getMonth() !== monthZeroBased ||
      end.getDate() !== day ||
      end.getHours() !== hour2 ||
      end.getMinutes() !== minute2 ||
      !(start.getTime() < end.getTime())
    ) {
      continue;
    }

    const segmentEnd =
      n + 1 < matches.length ? matches[n + 1].index : text.length;
    const segment = text.slice(match.index + match[0].length, segmentEnd);
    const idMatch =
      (idRe ? idRe.exec(segment) : null) ||
      (id7Re ? id7Re.exec(segment) : null);
    const eventId = idMatch ? Number(idMatch[1]) : null;
    const key = `${start.getTime()}|${end.getTime()}|${eventId === null ? "None" : eventId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const lesson = makeLesson(start, end, eventId);

    const levelMatch = levelRe?.exec(segment);
    if (levelMatch && /^[A-Z]$/.test(s(levelMatch[1]))) {
      lesson.level = s(levelMatch[1]);
    }

    const coreMatch = coreRe?.exec(segment);
    if (coreMatch) {
      lesson.index = Number(coreMatch[1]);
      lesson.subject = s(coreMatch[2]).trim();
      const region = segment.slice(0, coreMatch.index + coreMatch[0].length);
      if (teacherRe)
        lesson.teachers = allMatches(teacherRe, region)
          .map((m) => s(m[1]))
          .reverse();
      if (roomRe)
        lesson.rooms = allMatches(roomRe, region)
          .map((m) => s(m[1]))
          .reverse();
    }

    const remarkFound = remarkRe
      ? findFrom(
          remarkRe,
          segment,
          coreMatch ? coreMatch.index + coreMatch[0].length : 0,
        )
      : null;
    if (remarkFound) {
      const rm = remarkFound.match;
      lesson.remark = s(rm[1]).trim();

      // Student groups follow the remark token as a sequence of entries.
      const groupStart = remarkFound.index + 1 + rm[1].length;
      const groupMatch = chainRe
        ? findStickyAt(chainRe, segment, groupStart)
        : null;
      if (groupMatch && entryRe) {
        const names = allMatches(entryRe, groupMatch.match[0])
          .map((m) => s(m[1]))
          .reverse();
        lesson.classes = names.filter((name) => name && !name.startsWith("*"));
      }

      if (!lesson.subject) {
        const previousToken =
          segment.slice(0, remarkFound.index).split(",").at(-1) ?? "";
        const bookingType = /^\d+$/.test(previousToken)
          ? s(previousToken).trim()
          : "";
        const title = lesson.remark;
        if (EXAM_TYPES.has(bookingType)) {
          lesson.subject = title || bookingType;
          lesson.remark = bookingType;
          if (!lesson.level) {
            [lesson.subject, lesson.level] = splitLevel(lesson.subject);
          }
        } else if (bookingType) {
          lesson.subject = bookingType;
          lesson.remark = title;
        }
      }
    } else if (remarkOldRe) {
      const oldRemark = findFrom(
        remarkOldRe,
        segment,
        coreMatch ? coreMatch.index + coreMatch[0].length : 0,
      );
      if (oldRemark) lesson.remark = s(oldRemark.match[1]).trim();
    }

    if (eventId !== null && notes.has(eventId)) {
      const note = notes.get(eventId)!;
      lesson.homework = note.homework;
      lesson.note = note.note;
    }
    out.push(lesson);
  }

  return out.sort(
    (a, b) =>
      a.start.getTime() - b.start.getTime() ||
      a.end.getTime() - b.end.getTime(),
  );
}

/** Sticky matching is equivalent to Python's regex.match(text, position). */
function findStickyAt(
  re: RegExp,
  text: string,
  position: number,
): FoundMatch | null {
  const sticky = new RegExp(re.source, `${re.flags.replace(/[gy]/g, "")}y`);
  sticky.lastIndex = position;
  const match = sticky.exec(text);
  return match ? { match, index: match.index } : null;
}

export function parseSchedule(text: string, monday?: Date): Day[] {
  const lessons = decodeLessons(text);
  const byDay = new Map<string, Lesson[]>();
  for (const lesson of lessons) {
    const key = dateKey(lesson.start);
    const current = byDay.get(key) ?? [];
    current.push(lesson);
    byDay.set(key, current);
  }

  if (monday) {
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(monday, i);
      return { date, lessons: byDay.get(dateKey(date)) ?? [] };
    });
  }

  return [...byDay.keys()]
    .sort()
    .map((key) => ({ date: parseDate(key), lessons: byDay.get(key)! }));
}

// ---------------------------------------------------------------- output
function clip(text: string, short: boolean): string {
  const chars = Array.from(text);
  if (short && chars.length > 140)
    return chars.slice(0, 140).join("").trimEnd() + "...";
  return text;
}

function formatLesson(lesson: Lesson): string {
  const index = lesson.index === null ? "?" : String(lesson.index);
  const title = lesson.title || "?";
  return `${formatTime(lesson.start)}-${formatTime(lesson.end)}  L${index}  ${title.padEnd(18)} ${(lesson.rooms.join("-") || "?").padEnd(16)} ${(lesson.teachers.join(", ") || "-").padEnd(14)} ${lesson.classes.join(", ")}`.trimEnd();
}

function printWeek(monday: Date, days: Day[], short = false): void {
  console.log(
    `\n=== Week of ${formatDate(monday)} (ISO week ${isoWeekNumber(monday)}) ===`,
  );
  for (const { date, lessons } of days) {
    const weekday = date.getDay(); // Sunday=0, Saturday=6
    if ((weekday === 0 || weekday === 6) && lessons.length === 0) continue;
    console.log(
      `${WEEKDAYS[weekday]} ${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`,
      lessons.length ? "" : " - no lessons",
    );
    for (const lesson of lessons) {
      console.log(`   ${formatLesson(lesson)}`);
      for (const [label, value] of [
        ["Remark", lesson.remark],
        ["Homework", lesson.homework],
        ["Note", lesson.note],
      ] as const) {
        if (value) {
          const body = clip(value, short).replace(/\n/g, `\n${" ".repeat(18)}`);
          console.log(
            `        ${(label + ":").padEnd(10)}${body}`.replace(
              new RegExp(`${" ".repeat(18)}\n`, "g"),
              "\n",
            ),
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------- CLI / date helpers
interface CliArgs {
  weeks: number;
  start?: string;
  raw: boolean;
  short: boolean;
  file?: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { weeks: 1, raw: false, short: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    switch (value) {
      case "--weeks": {
        const raw = argv[++i];
        if (raw === undefined || !/^[+-]?\d+$/.test(raw))
          throw new CliError("--weeks requires an integer");
        args.weeks = Number.parseInt(raw, 10);
        break;
      }
      case "--from":
        args.start = argv[++i];
        if (!args.start)
          throw new CliError("--from requires a date in YYYY-MM-DD format");
        break;
      case "--raw":
        args.raw = true;
        break;
      case "--short":
        args.short = true;
        break;
      case "--file":
        args.file = argv[++i];
        if (!args.file) throw new CliError("--file requires a path");
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        throw new CliError(`unrecognized argument: ${value}`);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`usage: skema_fetch.ts [--weeks WEEKS] [--from START] [--raw] [--short] [--file FILE]

Fetch and print your Studie+ schedule.

options:
  --weeks WEEKS   how many weeks to fetch (default 1)
  --from START    YYYY-MM-DD; start at the week containing that date
  --raw           save each raw response to raw_<date>.txt
  --short         clip long notes/homework to 140 characters
  --file FILE     decode a saved response (no network)
  -h, --help      show this help`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.file) {
    const text = await readFile(args.file, "utf8");
    const dates = parseSchedule(text).map((day) => day.date);
    const mondays = new Map<string, Date>();
    for (const date of dates) {
      const monday = addDays(date, -((date.getDay() + 6) % 7));
      mondays.set(dateKey(monday), monday);
    }
    for (const monday of [...mondays.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, d]) => d)) {
      printWeek(monday, parseSchedule(text, monday), args.short);
    }
    return;
  }

  const cfg = await loadConfig();
  const day = args.start ? parseDate(args.start) : today();
  const monday = addDays(day, -((day.getDay() + 6) % 7));
  for (let week = 0; week < args.weeks; week += 1) {
    const weekMonday = addDays(monday, week * 7);
    printWeek(weekMonday, await getWeek(cfg, weekMonday, args.raw), args.short);
  }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
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
] as const;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatDate(date: Date): string {
  return `${pad2(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match)
    throw new CliError(`Invalid date '${value}': expected YYYY-MM-DD`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new CliError(`Invalid date '${value}'`);
  }
  return date;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function today(): Date {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isoWeekNumber(date: Date): number {
  // ISO week is calculated in UTC to avoid daylight-saving boundaries changing the result.
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function isNodeError(error: unknown): error is Error & { code?: string } {
  return error instanceof Error && "code" in error;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(__filename)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
