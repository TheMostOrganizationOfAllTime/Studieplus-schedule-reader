import { Lesson, ScheduleError, type Config, type Day } from "./types.ts";
import { decodeRoom } from "./decoder.ts";
import { fetchRoomWeekText, getRoomWeek } from "./api.ts";
import { addDays, dateKey, mondayOf, parseIsoDate } from "./dates.ts";
import { existsSync, readFileSync, writeFileSync } from "fs";

export async function scanRooms(
  cfg: Config,
  from: number,
  to: number,
  withNames = false,
): Promise<void> {
  const rooms: number[] = existsSync("validRoomIds.json")
    ? JSON.parse(readFileSync("validRoomIds.json", "utf8"))
    : [];

  const namedRooms: Record<number, string> =
    withNames && existsSync("roomNames.json")
      ? JSON.parse(readFileSync("roomNames.json", "utf8"))
      : {};

  const ids = Array.from(
    { length: Math.max(0, to - from + 1) },
    (_, i) => from + i,
  );

  const valid = new Array<boolean>(ids.length).fill(false);
  const monday = mondayOf(new Date());

  if (withNames) {
    for (const id of ids) {
      delete namedRooms[id];
    }
  }

  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;

      if (index >= ids.length) return;

      const id = ids[index];
      const text = await fetchRoomWeekText(cfg, id, monday);
      const room = decodeRoom(text);

      if (room) {
        valid[index] = true;
        if (withNames) namedRooms[id] = room.name ?? `NoName${id}`;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(20, ids.length) }, () => worker()),
  );

  const updatedRooms = [
    ...rooms.filter((id) => id < from || id > to),
    ...ids.filter((_, index) => valid[index]),
  ].sort((a, b) => a - b);

  writeFileSync("validRoomIds.json", JSON.stringify(updatedRooms));
  if (withNames) writeFileSync("roomNames.json", JSON.stringify(namedRooms));
}

export async function compileAllSchedules(
  cfg: Config,
  date: Date,
  weeks: number,
  classes?: string[],
  scanRange?: { from: number; to: number },
): Promise<void> {
  if (weeks <= 0)
    throw new ScheduleError("weeks must be a positive whole number.");

  if (!existsSync("validRoomIds.json"))
    scanRooms(
      cfg,
      scanRange?.from ?? cfg.minRoomId,
      scanRange?.to ?? cfg.maxRoomId,
    );
  const ids: number[] = JSON.parse(readFileSync("validRoomIds.json", "utf8"));

  const schedules: Record<string, Record<string, Lesson[]>> = {};
  const firstMonday = mondayOf(date);

  // Create one task for every room-week combination.
  const tasks = Array.from({ length: Math.max(0, weeks) }, (_, w) =>
    addDays(firstMonday, 7 * w),
  ).flatMap((monday) => ids.map((id) => ({ id, monday })));

  // Track lesson signatures to avoid repeatedly searching arrays.
  const seen = new Map<string, Set<string>>();

  const concurrency = 20;
  let nextTask = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextTask++;

      if (index >= tasks.length) return;

      const { id, monday } = tasks[index];
      const { days } = await getRoomWeek(cfg, id, monday);

      for (const day of days) {
        // Skips any days that has already passed.
        if (day.date < date) continue;

        const key = dateKey(day.date);

        for (const lesson of day.lessons) {
          const signature = JSON.stringify([
            lesson.start.getTime(),
            lesson.end.getTime(),
            lesson.subject,
            lesson.level,
          ]);

          for (const cl of lesson.classes) {
            if (classes && !classes.includes(cl)) continue;
            schedules[cl] ??= {};
            schedules[cl][key] ??= [];

            const bucketKey = JSON.stringify([cl, key]);

            let signatures = seen.get(bucketKey);

            if (!signatures) {
              signatures = new Set<string>();
              seen.set(bucketKey, signatures);
            }

            if (signatures.has(signature)) continue;

            signatures.add(signature);
            schedules[cl][key].push(lesson);
          }
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()),
  );

  for (const classes of Object.values(schedules)) {
    for (const lessons of Object.values(classes)) {
      lessons.sort((a, b) => a.start.getTime() - b.start.getTime());
    }
  }

  writeFileSync("allSchedules.json", JSON.stringify(schedules));
}

export function GetLocallyStoredSchedules(classes: string[]): Day[] {
  if (!existsSync("allSchedules.json"))
    throw new ScheduleError("allSchedules.json has not been generated");
  const allSchedules: Record<string, Record<string, Lesson[]>> = JSON.parse(
    readFileSync("allSchedules.json", "utf8"),
  );

  const week: Day[] = [];

  const seen = new Map<string, Set<string>>();
  for (const cl of classes) {
    for (const date of Object.keys(allSchedules[cl] ?? [])) {
      seen.set(date, seen.get(date) ?? new Set());

      const parsed = parseIsoDate(date);
      if (!parsed)
        throw new ScheduleError(
          "allSchedules.json does not follow the correct date format",
        );

      let index: number = week.findIndex((d) => dateKey(d.date) === date);
      if (index === -1) {
        index = week.length;
        week.push({ date: parsed, lessons: [] });
      }

      for (const lesson of allSchedules[cl][date]) {
        const signature = JSON.stringify([
          lesson.start,
          lesson.end,
          lesson.subject,
          lesson.level,
        ]);
        if (seen.get(date)!.has(signature)) continue;
        seen.get(date)!.add(signature);
        week[index].lessons.push(Lesson.fromJSON(lesson));
      }
    }
  }

  week.sort((a, b) => (a.date > b.date ? 1 : -1));
  for (const day of week)
    day.lessons.sort((a, b) => (a.start >= b.start ? 1 : -1));
  return week;
}
