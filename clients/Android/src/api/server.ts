import { LIST_NAMES, saveList, type Lists } from "../config/lists";

const TIMEOUT_MS = 8000;

/** "192.168.1.5:3000/" -> "http://192.168.1.5:3000" */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

async function get(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** True only if <url>/api answers with status 200. */
export async function pingServer(baseUrl: string): Promise<boolean> {
  try {
    return (await get(`${normalizeUrl(baseUrl)}/api`)).status === 200;
  } catch {
    return false;
  }
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Fetches /api/teachers, /api/rooms and /api/classes. Each one that succeeds
 * and is a string[] gets saved to its json file. Returns what was saved.
 */
export async function syncLists(baseUrl: string): Promise<Partial<Lists>> {
  const root = normalizeUrl(baseUrl);
  const saved: Partial<Lists> = {};
  await Promise.all(
    LIST_NAMES.map(async (name) => {
      try {
        const res = await get(`${root}/api/${name}`);
        if (res.status !== 200) return;
        const data: unknown = await res.json();
        if (!isStringArray(data)) return;
        saveList(name, data);
        saved[name] = data;
      } catch {
        // this list just isn't updated
      }
    }),
  );
  return saved;
}
