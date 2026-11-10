// Fetches the schedule and stores each week in its own json file.

import { File, Paths } from "expo-file-system";
import { getWeek, setTokenRefresher } from "../../../../lib/apiCore";
import { addDays, dateKey, mondayOf } from "../../../../lib/times";
import {
  dayFromJSON,
  type Config as LibConfig,
  type Day,
} from "../../../../lib/types";
import type { Config } from "../types";
import { DEFAULT_INSTNR, login, loginFailureMessage } from "./unilogin";

export interface UpdateResult {
  files: string[];
  utoken: string;
  strongName: string;
  permutation: string;
}

/** "schedule_2026-11-09.json": one file per week, named after that week's Monday. */
export const weekFileName = (monday: Date) =>
  `schedule_${dateKey(monday)}.json`;

const weekFile = (monday: Date) =>
  new File(Paths.document, weekFileName(monday));

function saveWeek(monday: Date, days: Day[]): void {
  const file = weekFile(monday);
  if (!file.exists) file.create();
  file.write(
    JSON.stringify({
      monday: dateKey(monday),
      updatedAt: new Date().toISOString(),
      days,
    }),
  );
}

/** Reads a stored week back. Null if that week has never been saved. */
export async function loadWeek(
  monday: Date,
): Promise<{ updatedAt: Date; days: Day[] } | null> {
  try {
    const file = weekFile(monday);
    if (!file.exists) return null;
    const data = JSON.parse(await file.text());
    return {
      updatedAt: new Date(data.updatedAt),
      days: data.days.map(dayFromJSON),
    };
  } catch {
    return null;
  }
}

/** Updates the current and next week. Throws an Error with a readable message on failure. */
export function updateSchedule(config: Config): Promise<UpdateResult> {
  return config.useLogin ? updateWithUnilogin(config) : updateManually(config);
}

async function updateWithUnilogin(config: Config): Promise<UpdateResult> {
  if (!config.utoken) throw new Error("Not logged in");

  // The config lib/api.ts expects. getWeek only needs instnr and utoken.
  const cfg: LibConfig = {
    instnr: DEFAULT_INSTNR,
    utoken: config.utoken,
    permutation: config.permutation,
    strongName: config.strongName,
    minRoomId: 0,
    maxRoomId: 0,
    minTeacherId: 0,
    maxTeacherId: 0,
  };

  setTokenRefresher(async () => {
    const result = await login(config.username, config.password);
    if (!result.ok) throw new Error(loginFailureMessage[result.reason]);
    if (result.params) {
      cfg.strongName = result.params.strongName;
      cfg.permutation = result.params.permutation;
    }
    return result.token;
  });

  const thisMonday = mondayOf(new Date());
  const mondays = [thisMonday, addDays(thisMonday, 7)];

  // Fetch everything first, so a failure doesn't leave one week updated and the other not.
  const weeks: { monday: Date; days: Day[] }[] = [];
  for (const monday of mondays) {
    weeks.push({ monday, days: await getWeek(cfg, monday) });
  }
  for (const { monday, days } of weeks) saveWeek(monday, days);

  return {
    files: mondays.map(weekFileName),
    utoken: cfg.utoken,
    strongName: cfg.strongName,
    permutation: cfg.permutation,
  };
}

async function updateManually(_config: Config): Promise<UpdateResult> {
  throw new Error("Updating without Unilogin is not yet supported");
}
