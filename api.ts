// Talks to Studie+: config, the request, and "fetch a week".

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, dateKey } from "./dates.ts";
import { decodeRoom, parseSchedule } from "./decoder.ts";
import {
  ScheduleError,
  type Config,
  type Day,
  type RoomWeek,
} from "./types.ts";

export const HERE = dirname(fileURLToPath(import.meta.url));
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

/** Reads config.json (next to this file). */
export function loadConfig(): Config {
  const path = join(HERE, "config.json");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      throw new ScheduleError(`Missing ${path} - see README_SETUP.md`);
    throw new ScheduleError(
      `config.json is not valid JSON (${(e as Error).message}). Keep the quotes around every value.`,
    );
  }
  const text = (key: string) => String(raw[key] ?? "").trim();
  for (const key of ["instnr", "utoken"]) {
    if (!text(key) || text(key).startsWith("PASTE")) {
      throw new ScheduleError(
        `config.json: "${key}" is not filled in - see README_SETUP.md`,
      );
    }
  }
  return {
    instnr: text("instnr"),
    utoken: text("utoken"),
    permutation: text("permutation"),
    strongName: text("strong_name"),
    minRoomId: raw["minRoomId"] as number,
    maxRoomId: raw["maxRoomId"] as number,
  };
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

/** Sends a request body to Studie+ and returns the raw response text. */
async function post(cfg: Config, body: string): Promise<string> {
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
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new ScheduleError(`Could not reach Studie+: ${(e as Error).message}`);
  }
  if (!response.ok) {
    throw new ScheduleError(
      `HTTP ${response.status} from server. 401/403 = cookies expired or wrong; ` +
        `500 = strong name changed (see README_SETUP.md).`,
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

/** Fetches and decodes one week. Always returns 7 days (Mon..Sun); days without lessons have []. */
export async function getWeek(
  cfg: Config,
  monday: Date,
  saveRaw = false,
): Promise<Day[]> {
  const text = await fetchWeekText(cfg, monday);
  if (saveRaw)
    writeFileSync(join(HERE, `raw_${dateKey(monday)}.txt`), text, "utf-8");
  return parseSchedule(text, monday);
}

/** Fetches one week of a room's schedule, together with the room's name. */
export async function getRoomWeek(
  cfg: Config,
  roomId: number,
  monday: Date,
  saveRaw = false,
): Promise<RoomWeek> {
  const text = await fetchRoomWeekText(cfg, roomId, monday);
  if (saveRaw)
    writeFileSync(
      join(HERE, `raw_room${roomId}_${dateKey(monday)}.txt`),
      text,
      "utf-8",
    );
  const room = decodeRoom(text) ?? {
    id: roomId,
    name: null,
    description: null,
  };
  return { room, days: parseSchedule(text, monday) };
}
