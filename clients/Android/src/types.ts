export type UpdateMode = "times" | "interval";

export interface ScheduleUpdateSettings {
  mode: UpdateMode;
  interval: string; // "HH:mm", used when mode is "interval"
  times: string[]; // ["HH:mm", ...], used when mode is "times"
}

export interface Config {
  enabled: boolean;
  useLogin: boolean;
  username: string;
  password: string;
  utoken: string | null;
  url: string;
  classes: string[];
  ignored: {
    rooms: string[];
    subjects: string[];
    teachers: string[];
  };
  base: number; // minutes
  conditionalOffset: Record<string, string>;
  scheduleUpdate: ScheduleUpdateSettings;
}
