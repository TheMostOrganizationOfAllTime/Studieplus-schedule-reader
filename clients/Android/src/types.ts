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
}
