import { dirname, join, resolve } from "node:path";

// Default: the folder of the entry script (cli.ts, server.ts, run-login.ts...).
let dir = dirname(resolve(process.argv[1] ?? "."));

/** Override where config.json and the other data files live. Call once at startup. */
export function setDataDir(path: string): void {
  dir = resolve(path);
}

/** Path to a data file in the running app's folder. */
export const dataPath = (...parts: string[]): string => join(dir, ...parts);
