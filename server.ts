import express from "express";
import { addDays, mondayOf, parseIsoDate } from "./dates.ts";
import { getTeacherWeek, getWeek, loadConfig } from "./api.ts";
import { ScheduleError, type Day, type Teacher } from "./types.ts";
import { readFileSync } from "fs";
import {
  compileAllSchedules,
  getLocallyStoredSchedules,
  updateSchedule,
} from "./scanner.ts";

const app = express();
const PORT = 3000;
const ALLOWSHOWINGPERSONALSCHEDULE = true;
const RECHECKTIMES = ["16:00"]; // Must be "HH:mm"

const cfg = loadConfig();

// Scheduler
function getNextRun(): Date {
  const now = new Date();
  const candidates: Date[] = [];

  for (const time of RECHECKTIMES) {
    const [hours, minutes] = time.split(":").map(Number);

    const candidate = new Date(now);
    candidate.setHours(hours, minutes, 0, 0);

    // If today's time has passed, schedule for tomorrow.
    if (candidate.getTime() <= now.getTime())
      candidate.setDate(candidate.getDate() + 1);

    candidates.push(candidate);
  }

  return candidates.reduce((earliest, current) =>
    current.getTime() < earliest.getTime() ? current : earliest,
  );
}

async function startScheduler(): Promise<void> {
  if (!RECHECKTIMES || RECHECKTIMES.length === 0)
    throw new ScheduleError("No scheduled times configured.");

  function scheduleNext(): void {
    const delay = getNextRun().getTime() - Date.now();

    setTimeout(async () => {
      // Schedule the next run independently of the current task.
      scheduleNext();
      compileAllSchedules(cfg, new Date(), 2);
    }, delay);
  }

  scheduleNext();
}

startScheduler();

// app.use(cookieParser())
app.use(express.json());

app.listen(PORT, () => console.log(`Server running on port: ${PORT}`));

app.get("/api", async (req, res) => res.status(200).send("Succes"));

// /api/teacher/123?weeks=1&from=2026-10-28
// /api/teacher/initials?weeks=1&from=2026-10-28
app.get("/api/teacher/:input", async (req, res) => {
  const input = isTeacher(req.params.input);
  if (input === null) return res.status(404).send("Teacher not found");
  let params = req.query as {
    weeks: string | undefined;
    from: string | undefined;
  };
  const weeks = Number(params.weeks) || 1;
  const from = mondayOf(
    params.from ? (parseIsoDate(params.from) ?? new Date()) : new Date(),
  );
  if (weeks == 1)
    return res.status(200).json(await getTeacherWeek(cfg, input!, from));

  const result: { days: Day[]; teacher: Teacher } = await getTeacherWeek(
    cfg,
    input!,
    from,
  );
  for (let i = 1; i < weeks; i++) {
    result.days.concat(
      (await getTeacherWeek(cfg, input!, addDays(from, 7 * i))).days,
    );
  }
  return res.status(200).json(result);
});

// /api/student?weeks=1&from=2026-10-28
// /api/student?class=24htce&class=24htceinB
app.get("/api/student", async (req, res) => {
  let params = req.query as {
    weeks: string | undefined;
    from: string | undefined;
    class: string | string[] | undefined;
  };
  const classes: string[] =
    params.class === undefined
      ? []
      : Array.isArray(params.class)
        ? params.class
        : [params.class];
  if (classes.length > 0)
    return res.status(200).json(getLocallyStoredSchedules(classes));

  if (ALLOWSHOWINGPERSONALSCHEDULE) {
    const weeks = Number(params.weeks) || 1;
    const from = mondayOf(
      params.from ? (parseIsoDate(params.from) ?? new Date()) : new Date(),
    );
    if (weeks === 1) return res.status(200).json(await getWeek(cfg, from));

    let result = await getWeek(cfg, from);
    for (let i = 1; i < weeks; i++)
      result = result.concat(await getWeek(cfg, addDays(from, 7 * i)));
    return res.status(200).json(result);
  }
  return res.status(401).send("Unauthorized");
});

// /api/newestSchedule?day=2026-10-30&class=24htce&class=24htceinB
app.get("/api/newestSchedule", async (req, res) => {
  let params = req.query as {
    day: string | undefined;
    class: string | string[] | undefined;
  };
  const classes: string[] =
    params.class === undefined
      ? []
      : Array.isArray(params.class)
        ? params.class
        : [params.class];
  const day = params.day ? parseIsoDate(params.day) : null;
  const schedule = await updateSchedule(cfg, classes);

  return res
    .status(200)
    .json(
      day
        ? schedule.find((schDay) => schDay.date.getTime() == day.getTime())
        : schedule,
    );
});

// Checks if the input is a valid teacher.
export function isTeacher(
  input: string | number,
  valid?: Record<string, number>,
): number | null {
  valid ??= JSON.parse(readFileSync("teachers.json", "utf8")) as Record<
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
