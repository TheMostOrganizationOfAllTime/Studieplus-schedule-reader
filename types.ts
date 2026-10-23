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
}

/** One calendar day and its lessons (sorted by start time). */
export interface Day {
  date: Date; // local midnight
  lessons: Lesson[];
}

/** A classroom, as reported by Studie+. */
export interface Room {
  id: number;
  /** "D4240" */
  name: string;
  /** "Salon", "Teorilokale", ... (may be empty) */
  description: string;
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
}

/** An error whose message is meant to be shown to the user as-is. */
export class ScheduleError extends Error {}
