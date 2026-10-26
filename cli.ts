#!/usr/bin/env -S npx tsx

import { existsSync, readFileSync } from "node:fs";
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
import { compileAllSchedules, getLocallyStoredSchedules } from "./scanner.ts";

async function main(): Promise<void> {
  // Optain arguments given when running command.
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", default: false },
      weeks: { type: "string", default: "1" },
      from: { type: "string" },
      raw: { type: "boolean", default: false },
      short: { type: "boolean", default: false },
      file: { type: "string" },
      room: { type: "string" },
      fromClasses: { type: "string", multiple: true },
      all: { type: "boolean", default: false },
    },
  });

  if (values.help) {
    console.log(readFileSync("help.txt"));
    return;
  }

  // Both argument "file" and argument "fromClasses" defines a source of the data and can therefore not exist simultaneously.
  if (values.file && values.fromClasses) {
    console.log(
      'Cannot have argument "file" and argument "fromClasses" simultaneously',
    );
    return;
  }

  // If the file argument is given, use the saved response in the file.
  if (values.file) {
    // Reads the file.
    const text = readFileSync(values.file, "utf-8");
    // Attempts to get room data and if available, print.
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

  const cfg = loadConfig();
  if (values.all) {
    await compileAllSchedules(cfg, new Date(), 2);
    return;
  }
  const firstMonday = mondayOf(day);
  if (values.fromClasses) {
    if (!existsSync("allSchedules.json"))
      await compileAllSchedules(cfg, new Date(), 2);
    console.log(
      formatWeek(firstMonday, getLocallyStoredSchedules(values.fromClasses)),
    );

    return;
  }

  if (values.room !== undefined && !/^\d+$/.test(values.room)) {
    throw new ScheduleError(
      "--room must be the numeric room id from the request payload, e.g. --room 950.",
    );
  }

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
