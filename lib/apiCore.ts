// Talks to Studie+: the request and "fetch a week".
// Platform-neutral (no Node imports), so the server AND the Android app can use it.
// The Node-only parts (config.json, saving raw responses) live in api.ts.

import { addDays, mondayOf, startOfDayOf } from "./times.ts";
import { decodeRoom, decodeTeacher, parseSchedule } from "./decoder.ts";
import {
  ScheduleError,
  Teacher,
  type Config,
  type Day,
  type RoomWeek,
} from "./types.ts";

let refreshToken: (() => Promise<string>) | null = null;

/** Each app registers how it gets a fresh utoken (server: Playwright, app: ask the server / WebView). */
export function setTokenRefresher(fn: () => Promise<string>): void {
  refreshToken = fn;
}

const BASE = "https://all.uddataplus.dk/skema/skema/";
const ENDPOINT = BASE + "skemaservice";
const DEFAULT_STRONG_NAME = "0E790BF304400AEF7F91A082938908F3";
const UDATE_TYPE = "dk.uddata.gwt.comm.shared.UDate/2314285719";
const SERVICE = "dk.uddata.services.interfaces.SkemaService";
const LIST_TYPE =
  "dk.uddata.services.interfaces.SkemaService$ListeType/2116933036";
const STRING_TYPE = "java.lang.String/2004016611";
/** The only ListeType value seen so far: it means "schedule of a room". */
const LIST_TYPE_ROOM = 0;
const LIST_TYPE_DEFAULT = 0;
const TEACHER_FLAG = 0;

/** AbortSignal.timeout() where it exists (Node); a small equivalent where it doesn't (React Native). */
function timeoutSignal(ms: number): AbortSignal {
  const native = (
    AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }
  ).timeout;
  if (typeof native === "function") return native.call(AbortSignal, ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/** A date as the request wants it:  <UDate type ref> | <"UDate:" ref> | year-1900 | month(0-based) | day | 0 | 0 | 0 */
function udate(typeRef: number, textRef: number, d: Date): string {
  return `${typeRef}|${textRef}|${d.getFullYear() - 1900}|${d.getMonth()}|${d.getDate()}|0|0|0|`;
}

/** Body for hentEgnePersSkemaData(UDate from, UDate to): your own schedule. */
export function buildBody(cfg: Config, from: Date, to: Date): string {
  const strongName = cfg.strongName || DEFAULT_STRONG_NAME;
  return (
    `7|0|6|${BASE}|${strongName}|${SERVICE}|hentEgnePersSkemaData|${UDATE_TYPE}|UDate:|` +
    `1|2|3|4|2|5|5|${udate(5, 6, from)}${udate(5, 6, to)}`
  );
}

/** Body for hentLokaSkemaData(ListeType, String roomId, UDate from, UDate to): a room's schedule. */
export function buildRoomBody(
  cfg: Config,
  roomId: number,
  from: Date,
  to: Date,
): string {
  const strongName = cfg.strongName || DEFAULT_STRONG_NAME;
  return (
    `7|0|9|${BASE}|${strongName}|${SERVICE}|hentLokaSkemaData|${LIST_TYPE}|${STRING_TYPE}|${UDATE_TYPE}|${roomId}|UDate:|` +
    `1|2|3|4|4|5|6|7|7|5|${LIST_TYPE_ROOM}|8|${udate(7, 9, from)}${udate(7, 9, to)}`
  );
}

/** Body for hentMedaSkemaData(ListeType, String teacherId, UDate from, UDate to, int): a teacher's schedule. */
export function buildTeacherBody(
  cfg: Config,
  teacherId: number,
  from: Date,
  to: Date,
): string {
  const strongName = cfg.strongName || DEFAULT_STRONG_NAME;
  return (
    `7|0|10|${BASE}|${strongName}|${SERVICE}|hentMedaSkemaData|${LIST_TYPE}|${STRING_TYPE}|${UDATE_TYPE}|I|${teacherId}|UDate:|` +
    `1|2|3|4|5|5|6|7|7|8|5|${LIST_TYPE_DEFAULT}|9|${udate(7, 10, from)}${udate(7, 10, to)}${TEACHER_FLAG}|`
  );
}

/** Sends a request body to Studie+ and returns the raw response text. */
async function post(
  cfg: Config,
  body: string,
  depth?: number,
): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "text/x-gwt-rpc; charset=UTF-8",
    "X-GWT-Module-Base": BASE,
    Cookie: `instnr=${cfg.instnr}; utoken=${cfg.utoken}`,
  };
  if (cfg.permutation) headers["X-GWT-Permutation"] = cfg.permutation;

  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body,
      signal: timeoutSignal(20_000),
    });
  } catch (e) {
    throw new ScheduleError(`Could not reach Studie+: ${(e as Error).message}`);
  }
  if (!response.ok) {
    if (
      (response.status === 401 || response.status === 403) &&
      (!depth || depth < 5)
    ) {
      if (!refreshToken)
        throw new ScheduleError(
          `HTTP ${response.status}: token expired and no refresher is set.`,
        );
      // cfg is a pointer so by updating the utoken here it will trickle upwards.
      cfg.utoken = await refreshToken();
      return await post(cfg, body, (depth ?? 0) + 1);
    }

    throw new ScheduleError(
      `HTTP ${response.status} from server. 401/403 = cookies expired or wrong; ` +
        `500 = strong name changed`,
    );
  }
  return response.text();
}

/** Raw response with your own schedule for Monday..Sunday of the given week. */
export function fetchWeekText(cfg: Config, monday: Date): Promise<string> {
  return post(cfg, buildBody(cfg, monday, addDays(monday, 6)));
}

/** Raw response with a room's schedule for Monday..Sunday of the given week. */
export function fetchRoomWeekText(
  cfg: Config,
  roomId: number,
  monday: Date,
): Promise<string> {
  return post(cfg, buildRoomBody(cfg, roomId, monday, addDays(monday, 6)));
}

export function fetchTeacherWeekText(
  cfg: Config,
  teacherId: number,
  monday: Date,
): Promise<string> {
  return post(
    cfg,
    buildTeacherBody(cfg, teacherId, monday, addDays(monday, 6)),
  );
}

/** Called with the raw response text before it is decoded (the server uses it to save debug files). */
export type RawHandler = (text: string) => void;

/** Fetches and decodes one week. Always returns 7 days (Mon..Sun); days without lessons have []. */
export async function getWeek(
  cfg: Config,
  monday: Date,
  onRaw?: RawHandler,
): Promise<Day[]> {
  const text = await fetchWeekText(cfg, monday);
  onRaw?.(text);
  return parseSchedule(text, monday);
}

/** Fetches one week of a room's schedule, together with the room's name. */
export async function getRoomWeek(
  cfg: Config,
  roomId: number,
  monday: Date,
  onRaw?: RawHandler,
): Promise<RoomWeek> {
  const text = await fetchRoomWeekText(cfg, roomId, monday);
  onRaw?.(text);
  const room = decodeRoom(text) ?? {
    id: roomId,
    name: null,
    description: null,
  };
  return { room, days: parseSchedule(text, monday) };
}

/** One week of a teacher's schedule. Always 7 days (Mon..Sun). */
export async function getTeacherWeek(
  cfg: Config,
  teacherId: number,
  monday: Date,
  onRaw?: RawHandler,
): Promise<{ days: Day[]; teacher: Teacher }> {
  const text = await fetchTeacherWeekText(cfg, teacherId, monday);
  onRaw?.(text);
  const teacher = decodeTeacher(text);
  if (teacher === null) throw new ScheduleError("Invalid teacher ID");
  return { days: parseSchedule(text, monday), teacher };
}

/** Looks up a teacher by id (one network call). Null if the id is not a teacher. */
export async function getTeacher(
  cfg: Config,
  teacherId: number,
  monday: Date = mondayOf(startOfDayOf(new Date())),
): Promise<Teacher | null> {
  return decodeTeacher(await fetchTeacherWeekText(cfg, teacherId, monday));
}
