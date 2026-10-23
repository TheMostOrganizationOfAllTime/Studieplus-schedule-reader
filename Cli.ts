#!/usr/bin/env -S npx tsx
// Fetch your Studie+ schedule and print it, so you can check it by eye.
//
//   npm start                          # this week only (one network call)
//   npm start -- --weeks 4             # this week + the next 3 (one call per week)
//   npm start -- --from 2026-11-09     # start at the week containing that date
//   npm start -- --raw                 # also save every raw response to raw_<date>.txt
//   npm start -- --short               # cut long notes/homework to 140 characters
//   npm start -- --file resp.txt       # decode a saved response (no network)

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { getWeek, loadConfig } from "./api.ts";
import {
  addDays,
  dateKey,
  mondayOf,
  parseIsoDate,
  startOfDayOf,
} from "./dates.ts";
import { parseSchedule } from "./decoder.ts";
import { formatWeek } from "./format.ts";
import { ScheduleError } from "./Types.ts";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      weeks: { type: "string", default: "1" },
      from: { type: "string" },
      raw: { type: "boolean", default: false },
      short: { type: "boolean", default: false },
      file: { type: "string" },
    },
  });

  if (values.file) {
    const text = readFileSync(values.file, "utf-8");
    const mondays = new Map<string, Date>();
    for (const { date } of parseSchedule(text))
      mondays.set(dateKey(mondayOf(date)), mondayOf(date));
    for (const key of [...mondays.keys()].sort()) {
      const monday = mondays.get(key)!;
      console.log(
        formatWeek(monday, parseSchedule(text, monday), values.short),
      );
    }
    return;
  }

  const weeks = Number(values.weeks);
  if (!Number.isInteger(weeks) || weeks < 1)
    throw new ScheduleError("--weeks must be a positive whole number.");
  let day = startOfDayOf(new Date());
  if (values.from) {
    const parsed = parseIsoDate(values.from);
    if (!parsed) throw new ScheduleError("--from must look like 2026-11-09.");
    day = parsed;
  }

  const cfg = loadConfig();
  const firstMonday = mondayOf(day);
  for (let w = 0; w < weeks; w++) {
    const monday = addDays(firstMonday, 7 * w);
    console.log(
      formatWeek(monday, await getWeek(cfg, monday, values.raw), values.short),
    );
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof ScheduleError ? e.message : e);
  process.exitCode = 1;
});
