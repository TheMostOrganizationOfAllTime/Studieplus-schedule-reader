#!/usr/bin/env -S npx tsx
// Fetch your Studie+ schedule and print it, so you can check it by eye.
//
//   npm start                          # this week only (one network call)
//   npm start -- --weeks 4             # this week + the next 3 (one call per week)
//   npm start -- --from 2026-11-09     # start at the week containing that date
//   npm start -- --raw                 # also save every raw response to raw_<date>.txt
//   npm start -- --short               # cut long notes/homework to 140 characters
//   npm start -- --file resp.txt       # decode a saved response (no network)
//   npm start -- --room 950            # the schedule of a room instead of your own (id from the request payload)

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { getRoomWeek, getWeek, loadConfig } from "./api.ts";
import {
  addDays,
  dateKey,
  mondayOf,
  parseIsoDate,
  startOfDayOf,
} from "./dates.ts";
import { decodeRoom, parseSchedule } from "./decoder.ts";
import { formatRoom, formatWeek } from "./format.ts";
import { ScheduleError } from "./types.ts";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      weeks: { type: "string", default: "1" },
      from: { type: "string" },
      raw: { type: "boolean", default: false },
      short: { type: "boolean", default: false },
      file: { type: "string" },
      room: { type: "string" },
    },
  });

  if (values.file) {
    const text = readFileSync(values.file, "utf-8");
    const room = decodeRoom(text);
    if (room) console.log(formatRoom(room));
    const mondays = new Map<string, Date>();
    for (const { date } of parseSchedule(text))
      mondays.set(dateKey(mondayOf(date)), mondayOf(date));
    if (mondays.size === 0) console.log("No lessons in this response.");
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

  if (values.room !== undefined && !/^\d+$/.test(values.room)) {
    throw new ScheduleError(
      "--room must be the numeric room id from the request payload, e.g. --room 950.",
    );
  }

  const cfg = loadConfig();
  const firstMonday = mondayOf(day);
  for (let w = 0; w < weeks; w++) {
    const monday = addDays(firstMonday, 7 * w);
    if (values.room !== undefined) {
      const { room, days } = await getRoomWeek(
        cfg,
        Number(values.room),
        monday,
        values.raw,
      );
      if (w === 0) console.log(formatRoom(room));
      console.log(formatWeek(monday, days, values.short));
    } else {
      console.log(
        formatWeek(
          monday,
          await getWeek(cfg, monday, values.raw),
          values.short,
        ),
      );
    }
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof ScheduleError ? e.message : e);
  process.exitCode = 1;
});
