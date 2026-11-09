// Node-side entry point: everything from apiCore.ts plus the parts that need the file system.
// The Android app imports apiCore.ts directly, because node:fs doesn't exist on a phone.

import { readFileSync, writeFileSync } from "node:fs";
import { dateKey } from "./times.ts";
import {
  getRoomWeek as fetchRoomWeek,
  getTeacherWeek as fetchTeacherWeek,
  getWeek as fetchWeek,
} from "./apiCore.ts";
import {
  ScheduleError,
  type Config,
  type Day,
  type RoomWeek,
  type Teacher,
} from "./types.ts";
import { dataPath } from "./paths.ts";

export {
  setTokenRefresher,
  buildBody,
  buildRoomBody,
  buildTeacherBody,
  fetchWeekText,
  fetchRoomWeekText,
  fetchTeacherWeekText,
  getTeacher,
} from "./apiCore.ts";

/** Reads config.json (next to this file). */
export function loadConfig(): Config {
  const path = dataPath("config.json");
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
    minTeacherId: raw["minTeacherId"] as number,
    maxTeacherId: raw["maxTeacherId"] as number,
  };
}

/** Writes a raw response to a debug file next to the running app. */
const saveRawTo = (fileName: string) => (text: string) =>
  writeFileSync(dataPath(fileName), text, "utf-8");

/** Fetches and decodes one week. Always returns 7 days (Mon..Sun); days without lessons have []. */
export async function getWeek(
  cfg: Config,
  monday: Date,
  saveRaw = false,
): Promise<Day[]> {
  return fetchWeek(
    cfg,
    monday,
    saveRaw ? saveRawTo(`raw_${dateKey(monday)}.txt`) : undefined,
  );
}

/** Fetches one week of a room's schedule, together with the room's name. */
export async function getRoomWeek(
  cfg: Config,
  roomId: number,
  monday: Date,
  saveRaw = false,
): Promise<RoomWeek> {
  return fetchRoomWeek(
    cfg,
    roomId,
    monday,
    saveRaw ? saveRawTo(`raw_room${roomId}_${dateKey(monday)}.txt`) : undefined,
  );
}

/** One week of a teacher's schedule. Always 7 days (Mon..Sun). */
export async function getTeacherWeek(
  cfg: Config,
  teacherId: number,
  monday: Date,
  saveRaw = false,
): Promise<{ days: Day[]; teacher: Teacher }> {
  return fetchTeacherWeek(
    cfg,
    teacherId,
    monday,
    saveRaw
      ? saveRawTo(`raw_teacher${teacherId}_${dateKey(monday)}.txt`)
      : undefined,
  );
}
