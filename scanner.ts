import { type Config } from "./types.ts";
import { decodeRoom } from "./decoder.ts";
import { fetchRoomWeekText } from "./api.ts";
import { mondayOf } from "./dates.ts";
import { existsSync, readFileSync, writeFileSync } from "fs";

export async function scanRooms(
  cfg: Config,
  from: number,
  to: number,
  withNames = false,
): Promise<void> {
  const rooms: number[] = existsSync("validRoomIds.json")
    ? JSON.parse(readFileSync("validRoomIds.json", "utf8"))
    : [];

  const namedRooms: Record<number, string> =
    withNames && existsSync("roomNames.json")
      ? JSON.parse(readFileSync("roomNames.json", "utf8"))
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

  writeFileSync("validRoomIds.json", JSON.stringify(updatedRooms));
  if (withNames) writeFileSync("roomNames.json", JSON.stringify(namedRooms));
}
