import type { AuthMeResponse } from "./api";

export const appPaths = {
  login: "#/login",
  diary: "#/diary",
} as const;

export type AppPath = (typeof appPaths)[keyof typeof appPaths];

export type GenerationState = "idle" | "creating" | "processing" | "failed" | "completed";

export const storageKeys = {
  accessToken: "futureDiary.accessToken",
  timezone: "futureDiary.timezone",
} as const;

export const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"] as const;

export type SessionState = {
  accessToken: string;
  timezone: string;
  user: AuthMeResponse["user"];
  session: AuthMeResponse["session"];
};

export type CalendarDay = {
  isoDate: string;
  dayOfMonth: number;
  inCurrentMonth: boolean;
};
