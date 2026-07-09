export const UK_TIME_ZONE = "Europe/London";

type DateInput = Date | string | number | null | undefined;

const ukDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: UK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function toDate(input: DateInput): Date | null {
  if (input instanceof Date) {
    return Number.isFinite(input.getTime()) ? input : null;
  }
  if (typeof input === "number") {
    const date = new Date(input);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof input === "string") {
    const parsed = Date.parse(input);
    if (!Number.isFinite(parsed)) return null;
    return new Date(parsed);
  }
  return null;
}

function ukParts(input: DateInput) {
  const date = toDate(input);
  if (!date) return null;
  const parts = ukDateTimeFormatter.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return {
    year: Number(pick("year")),
    month: Number(pick("month")),
    day: Number(pick("day")),
    hour: Number(pick("hour")),
    minute: Number(pick("minute")),
    second: Number(pick("second")),
  };
}

function ukOffsetMinutes(instantMs: number): number {
  const parts = ukParts(instantMs);
  if (!parts) return 0;
  const asUtcFromUkParts = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return (asUtcFromUkParts - instantMs) / 60000;
}

export function ukDateTimeToUtcDate(input: {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
}): Date {
  const hour = Number(input.hour || 0);
  const minute = Number(input.minute || 0);
  const second = Number(input.second || 0);
  let guess = Date.UTC(input.year, input.month - 1, input.day, hour, minute, second);
  for (let i = 0; i < 4; i += 1) {
    const offset = ukOffsetMinutes(guess);
    const nextGuess = Date.UTC(input.year, input.month - 1, input.day, hour, minute, second) - offset * 60000;
    if (Math.abs(nextGuess - guess) < 1000) {
      guess = nextGuess;
      break;
    }
    guess = nextGuess;
  }
  return new Date(guess);
}

export function getUkNow(): Date {
  return new Date();
}

export function ukDateKeyFromTimestamp(input: DateInput): string {
  const parts = ukParts(input);
  if (!parts) return "";
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function getUkTodayKey(now: DateInput = Date.now()): string {
  return ukDateKeyFromTimestamp(now);
}

export function parseUkDateInput(value: string): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, "0")}-${String(dmy[1]).padStart(2, "0")}`;
  const date = toDate(raw);
  if (!date) return null;
  return ukDateKeyFromTimestamp(date);
}

export function normaliseDateOnlyValue(value: string): string | null {
  return parseUkDateInput(value);
}

export function normaliseTimestampForStorage(value: DateInput = Date.now()): string {
  const date = toDate(value) || new Date();
  return date.toISOString();
}

export function compareUkCalendarDates(left: string, right: string): number {
  const l = parseUkDateInput(left);
  const r = parseUkDateInput(right);
  if (!l && !r) return 0;
  if (!l) return -1;
  if (!r) return 1;
  return l.localeCompare(r);
}

export function isUkToday(value: DateInput, now: DateInput = Date.now()): boolean {
  const target = ukDateKeyFromTimestamp(value);
  if (!target) return false;
  return target === getUkTodayKey(now);
}

export function isUkOverdue(dateOnly: string, now: DateInput = Date.now()): boolean {
  const due = parseUkDateInput(dateOnly);
  if (!due) return false;
  return compareUkCalendarDates(due, getUkTodayKey(now)) < 0;
}

export function ukStartOfDayUtc(dateOnly: string): Date | null {
  const normalized = parseUkDateInput(dateOnly);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map((part) => Number(part));
  return ukDateTimeToUtcDate({ year, month, day, hour: 0, minute: 0, second: 0 });
}

export function diffUkCalendarDays(target: string, base: DateInput = Date.now()): number | null {
  const targetStart = ukStartOfDayUtc(target);
  if (!targetStart) return null;
  const baseKey = getUkTodayKey(base);
  const baseStart = ukStartOfDayUtc(baseKey);
  if (!baseStart) return null;
  return Math.ceil((targetStart.getTime() - baseStart.getTime()) / 86400000);
}

export function formatUkDate(value: DateInput): string {
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIME_ZONE,
    dateStyle: "medium",
  }).format(date);
}

export function formatUkTime(value: DateInput): string {
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIME_ZONE,
    timeStyle: "short",
  }).format(date);
}

export function formatUkDateTime(value: DateInput): string {
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function toUkDateTimeForDisplay(value: DateInput): string {
  return formatUkDateTime(value);
}
