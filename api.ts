// Talks to Studie+: config, the request, and "fetch a week".

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, dateKey } from "./dates.ts";
import { parseSchedule } from "./decoder.ts";
import { ScheduleError, type Config, type Day } from "./Types.ts";

export const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = "https://all.uddataplus.dk/skema/skema/";
const ENDPOINT = BASE + "skemaservice";
const DEFAULT_STRONG_NAME = "0E790BF304400AEF7F91A082938908F3";
const UDATE_TYPE = "dk.uddata.gwt.comm.shared.UDate/2314285719";
const SERVICE = "dk.uddata.services.interfaces.SkemaService";

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
  };
}

/** Body for hentEgnePersSkemaData(UDate from, UDate to).
 *  A UDate is sent as:  5 | 6 | year-1900 | month(0-based) | day | 0 | 0 | 0 */
export function buildBody(cfg: Config, from: Date, to: Date): string {
  const udate = (d: Date) =>
    `5|6|${d.getFullYear() - 1900}|${d.getMonth()}|${d.getDate()}|0|0|0|`;
  const strongName = cfg.strongName || DEFAULT_STRONG_NAME;
  return (
    `7|0|6|${BASE}|${strongName}|${SERVICE}|hentEgnePersSkemaData|${UDATE_TYPE}|UDate:|` +
    `1|2|3|4|2|5|5|${udate(from)}${udate(to)}`
  );
}

/** Raw response for Monday..Sunday of the given week. */
export async function fetchWeekText(
  cfg: Config,
  monday: Date,
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
      body: buildBody(cfg, monday, addDays(monday, 6)),
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
