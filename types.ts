/** One entry in the schedule. */
export class Lesson {
  readonly start: Date;
  readonly end: Date;
  /** Lesson number 1-6. 0 for non-lesson slots (booking, class day). null if unknown. */
  index: number | null = null;
  /** "Biologi" */
  subject = "";
  /** "A", "B", "C" or "" */
  level = "";
  /** ["D2366", "Virtuel C"] */
  rooms: string[] = [];
  /** ["msh", "lear", "rbe"] */
  teachers: string[] = [];
  /** Student groups, e.g. ["24vfcbiB"]. Empty for booking lessons. */
  classes: string[] = [];
  note = "";
  homework = "";
  remark = "";
  /** Studie+'s internal id, useful for debugging. */
  eventId: number | null = null;

  constructor(start: Date, end: Date) {
    this.start = start;
    this.end = end;
  }

  /** Subject with level, e.g. "Biologi B". */
  get title(): string {
    return `${this.subject} ${this.level}`.trim();
  }

  // in class Lesson
  static fromJSON(d: Record<string, any>): Lesson {
    const lesson = new Lesson(new Date(d.start), new Date(d.end));
    lesson.index = d.index ?? null;
    lesson.subject = d.subject ?? "";
    lesson.level = d.level ?? "";
    lesson.rooms = d.rooms ?? [];
    lesson.teachers = d.teachers ?? [];
    lesson.classes = d.classes ?? [];
    lesson.note = d.note ?? "";
    lesson.homework = d.homework ?? "";
    lesson.remark = d.remark ?? "";
    lesson.eventId = d.eventId ?? null;
    return lesson;
  }
}

/** One calendar day and its lessons (sorted by start time). */
export interface Day {
  date: Date; // local midnight
  lessons: Lesson[];
}

// next to the Day interface
export function dayFromJSON(d: { date: string; lessons: unknown[] }): Day {
  return {
    date: new Date(d.date),
    lessons: d.lessons.map((l) => Lesson.fromJSON(l as Record<string, any>)),
  };
}

/** A classroom, as reported by Studie+. */
export interface Room {
  id: number;
  /** "D4240". null if Studie+ sent no room info (invalid room id). */
  name: string | null;
  /** "Salon", "Teorilokale", ... null if none. */
  description: string | null;
}

/** One week of one room's schedule. */
export interface RoomWeek {
  room: Room;
  days: Day[];
}

/** Settings read from config.json. */
export interface Config {
  instnr: string;
  utoken: string;
  /** Optional X-GWT-Permutation header value. */
  permutation: string;
  /** Optional override of the GWT strong name. */
  strongName: string;
  // the default range to scan for valid rooms.
  minRoomId: number;
  maxRoomId: number;
}

/** An error whose message is meant to be shown to the user as-is. */
export class ScheduleError extends Error {}
