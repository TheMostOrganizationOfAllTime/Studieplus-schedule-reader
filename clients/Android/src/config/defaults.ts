import type { Config } from "../types";

export const defaultConfig: Config = {
  enabled: true,
  useLogin: false,
  username: "",
  password: "",
  utoken: null,
  classes: [],
  ignored: {
    rooms: [
      "Virtuel C",
      "Virtuel S",
      "Virtuel T1",
      "Virtuel V",
      "Virtuelt",
      "Virtuel T2",
      "Virtuel T3",
    ],
    subjects: [],
    teachers: [],
  },
  base: 30,
  conditionalOffset: {},
};
