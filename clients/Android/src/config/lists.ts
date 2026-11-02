import { File, Paths } from "expo-file-system";

export const LIST_NAMES = ["teachers", "rooms", "classes"] as const;
export type ListName = (typeof LIST_NAMES)[number];
export type Lists = Record<ListName, string[]>;

const fileFor = (name: ListName) => new File(Paths.document, `${name}.json`);

export function saveList(name: ListName, values: string[]): void {
  const file = fileFor(name);
  if (!file.exists) file.create();
  file.write(JSON.stringify(values));
}

/** Reads whatever lists have been saved so far; missing or broken files give []. */
export async function loadLists(): Promise<Lists> {
  const lists: Lists = { teachers: [], rooms: [], classes: [] };
  for (const name of LIST_NAMES) {
    try {
      const file = fileFor(name);
      if (!file.exists) continue;
      const data: unknown = JSON.parse(await file.text());
      if (Array.isArray(data)) {
        lists[name] = data.filter((x): x is string => typeof x === "string");
      }
    } catch {
      // ignore unreadable file
    }
  }
  return lists;
}
