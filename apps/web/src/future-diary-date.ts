import type { CalendarDay } from "./future-diary-types";

const monthKeyPattern = /^\d{4}-\d{2}$/;

const monthLabelFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "UTC",
  year: "numeric",
  month: "long",
});

export const detectBrowserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo";
  } catch {
    return "Asia/Tokyo";
  }
};

export const formatDateInTimeZone = (date: Date, timeZone: string): string => {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;

    if (!year || !month || !day) {
      throw new Error("Invalid date parts");
    }

    return `${year}-${month}-${day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
};

export const previousIsoDate = (isoDate: string): string | null => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) {
    return null;
  }

  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

export const parseMonthKey = (monthKey: string): { year: number; month: number } | null => {
  if (!monthKeyPattern.test(monthKey)) {
    return null;
  }

  const [yearText, monthText] = monthKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  return { year, month };
};

const formatMonthKey = (year: number, month: number): string =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;

export const shiftMonthKey = (monthKey: string, diffMonths: number): string => {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) {
    return monthKey;
  }

  const base = new Date(Date.UTC(parsed.year, parsed.month - 1, 1));
  base.setUTCMonth(base.getUTCMonth() + diffMonths);
  return formatMonthKey(base.getUTCFullYear(), base.getUTCMonth() + 1);
};

export const buildCalendarDays = (monthKey: string): readonly CalendarDay[] => {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) {
    return [];
  }

  const firstDate = new Date(Date.UTC(parsed.year, parsed.month - 1, 1));
  const startOffset = firstDate.getUTCDay();
  const gridStart = new Date(Date.UTC(parsed.year, parsed.month - 1, 1 - startOffset));
  const days: CalendarDay[] = [];

  for (let index = 0; index < 42; index += 1) {
    const day = new Date(gridStart);
    day.setUTCDate(gridStart.getUTCDate() + index);
    days.push({
      isoDate: day.toISOString().slice(0, 10),
      dayOfMonth: day.getUTCDate(),
      inCurrentMonth: day.getUTCMonth() === parsed.month - 1,
    });
  }

  return days;
};

export const formatMonthLabel = (monthKey: string): string => {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) {
    return monthKey;
  }

  return monthLabelFormatter.format(new Date(Date.UTC(parsed.year, parsed.month - 1, 1)));
};
