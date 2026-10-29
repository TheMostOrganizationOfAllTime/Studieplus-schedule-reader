import { Lesson, ScheduleError, type Config, type Day } from "./types.ts";
import { decodeRoom, decodeTeacher } from "./decoder.ts";
import {
  fetchRoomWeekText,
  fetchTeacherWeekText,
  getRoomWeek,
  getTeacherWeek,
} from "./api.ts";
import {
  addDays,
  dateKey,
  mondayOf,
  parseIsoDate,
  startOfDayOf,
} from "./dates.ts";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url)) + "/";

export async function scanRooms(
  cfg: Config,
  from?: number,
  to?: number,
  withNames = false,
): Promise<void> {
  from ??= cfg.minRoomId;
  to ??= cfg.maxRoomId;
  const rooms: number[] = existsSync(HERE + "validRoomIds.json")
    ? JSON.parse(readFileSync(HERE + "validRoomIds.json", "utf8"))
    : [];

  const namedRooms: Record<number, string> =
    withNames && existsSync(HERE + "roomNames.json")
      ? JSON.parse(readFileSync(HERE + "roomNames.json", "utf8"))
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

  writeFileSync(HERE + "validRoomIds.json", JSON.stringify(updatedRooms));
  if (withNames)
    writeFileSync(HERE + "roomNames.json", JSON.stringify(namedRooms));
}

export async function scanTeachers(
  cfg: Config,
  from?: number,
  to?: number,
): Promise<void> {
  from ??= cfg.minTeacherId;
  to ??= cfg.maxTeacherId;
  const teachers: Record<string, number> = existsSync(HERE + "teachers.json")
    ? JSON.parse(readFileSync(HERE + "teachers.json", "utf8"))
    : {};
  for (const teacher of Object.keys(teachers)) {
    if (teachers[teacher] > from || teachers[teacher] < to)
      delete teachers[teacher];
  }

  const ids = Array.from(
    { length: Math.max(0, to - from + 1) },
    (_, i) => from + i,
  );

  const initials = new Array<string | undefined>(ids.length);
  const monday = mondayOf(new Date());

  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;

      if (index >= ids.length) return;

      const id = ids[index];
      const text = await fetchTeacherWeekText(cfg, id, monday);
      const teacher = decodeTeacher(text);

      initials[index] = teacher?.initials;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(20, ids.length) }, () => worker()),
  );

  for (let i = 0; i < initials.length; i++) {
    const initial = initials[i];
    if (initial !== undefined) teachers[initial] = ids[i];
  }

  writeFileSync(HERE + "teachers.json", JSON.stringify(teachers));
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

  if (!existsSync(HERE + "validRoomIds.json"))
    await scanRooms(cfg, scanRange?.from, scanRange?.to);
  const ids: number[] = JSON.parse(
    readFileSync(HERE + "validRoomIds.json", "utf8"),
  );

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

  writeFileSync(HERE + "allSchedules.json", JSON.stringify(schedules));
}

export function getLocallyStoredSchedules(classes: string[]): Day[] {
  if (!existsSync(HERE + "allSchedules.json"))
    throw new ScheduleError("allSchedules.json has not been generated");
  const allSchedules: Record<string, Record<string, Lesson[]>> = JSON.parse(
    readFileSync(HERE + "allSchedules.json", "utf8"),
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

export async function updateSchedule(cfg: Config, classes: string[]) {
  const current = getLocallyStoredSchedules(classes);
  const mondays = [
    ...new Set(current.map((day) => dateKey(mondayOf(day.date)))),
  ].map((date) => parseIsoDate(date)!);
  const teacherMap: Record<string, number> = existsSync("HERE + teachers.json")
    ? JSON.parse(readFileSync(HERE + "teachers.json", "utf8"))
    : {};
  const teachers = new Set(
    current.flatMap((day) =>
      day.lessons.flatMap((lesson) =>
        lesson.teachers.map((teacher) => teacherMap[teacher]),
      ),
    ),
  );
  const updated = Object.values(
    (
      await Promise.all(
        mondays.map(async (monday) =>
          (
            await Promise.all(
              [...teachers].map(async (teacher) =>
                (await getTeacherWeek(cfg, teacher, monday)).days.map(
                  (day) => ({
                    ...day,
                    lessons: day.lessons.filter((lesson) =>
                      lesson.classes.some((cl) => classes.includes(cl)),
                    ),
                  }),
                ),
              ),
            )
          ).flat(),
        ),
      )
    )
      .flat()
      .filter((day) => day.lessons.length > 0)
      .reduce<Record<string, Day>>((acc, day) => {
        const key = dateKey(day.date);
        if (acc[key]) {
          acc[key].lessons.push(...day.lessons);
        } else {
          acc[key] = { ...day, lessons: [...day.lessons] };
        }
        return acc;
      }, {}),
  )
    .map((day) => ({
      ...day,
      lessons: day.lessons.sort(
        (a, b) => a.start.getTime() - b.start.getTime(),
      ),
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime()) as Day[];

  const today = startOfDayOf(new Date());

  if (
    compareSchedules(
      current.filter((day) => today <= day.date),
      updated.filter((day) => today <= day.date),
    )
  )
    return current;
  await compileAllSchedules(cfg, new Date(), 2);
  return getLocallyStoredSchedules(classes);
}

function compareSchedules(a: Day[], b: Day[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (day, di) =>
        dateKey(day.date) === dateKey(b[di].date) &&
        day.lessons.length === b[di].lessons.length &&
        day.lessons.every(
          (lesson, li) => lesson.eventId === b[di].lessons[li].eventId,
        ),
    )
  );
}

// Checks if the input is a valid teacher.
export function isTeacher(
  input: string | number,
  valid?: Record<string, number>,
): number | null {
  valid ??= JSON.parse(readFileSync(HERE + "teachers.json", "utf8")) as Record<
    string,
    number
  >;
  if (typeof input === "string") {
    if (valid[input] !== undefined) return valid[input];
    if (!/^\d+$/.test(input)) return null;
    input = Number(input);
  }
  for (const id of Object.values(valid)) if (id === input) return id;
  return null;
}
