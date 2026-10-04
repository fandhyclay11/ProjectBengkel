export class DateTimeInputError extends Error {}

function timezone() {
  const value = process.env.APP_WORKSHOP_TIMEZONE?.trim() || "Asia/Jakarta";
  try { new Intl.DateTimeFormat("en", { timeZone: value }); }
  catch { throw new DateTimeInputError("Zona waktu bengkel tidak valid."); }
  return value;
}

export function workshopTimezone() { return timezone(); }

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

export type WorkshopDateRange = { from: Date; toExclusive: Date; fromDate: string; toDate: string };

function asUtcMillis(parts: Parts) {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, 0, 0);
  return date.getTime();
}

function readParts(date: Date, zone: string): Parts {
  const pieces = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(pieces.map((part) => [part.type, part.value]));
  return { year: Number(value.year), month: Number(value.month), day: Number(value.day), hour: Number(value.hour), minute: Number(value.minute) };
}

function sameParts(left: Parts, right: Parts) {
  return left.year === right.year && left.month === right.month && left.day === right.day && left.hour === right.hour && left.minute === right.minute;
}

export function parseWorkshopDateTime(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new DateTimeInputError("Tanggal dan waktu tidak valid.");
  const requested = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]) };
  if (requested.month < 1 || requested.month > 12 || requested.day < 1 || requested.day > 31 || requested.hour > 23 || requested.minute > 59) {
    throw new DateTimeInputError("Tanggal dan waktu tidak valid.");
  }
  const target = asUtcMillis(requested);
  const normalized = readParts(new Date(target), "UTC");
  if (!sameParts(normalized, requested)) throw new DateTimeInputError("Tanggal dan waktu tidak valid.");

  const zone = timezone();
  let candidate = target;
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const shown = readParts(new Date(candidate), zone);
    const adjustment = target - asUtcMillis(shown);
    if (adjustment === 0) return new Date(candidate);
    candidate += adjustment;
  }
  if (!sameParts(readParts(new Date(candidate), zone), requested)) {
    throw new DateTimeInputError("Waktu tersebut tidak tersedia pada zona waktu bengkel.");
  }
  return new Date(candidate);
}

export function workshopDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone(), year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}${value.month}${value.day}`;
}

function nextCalendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

export function workshopDateRange(fromDate: string, toDate: string): WorkshopDateRange {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(fromDate) || !datePattern.test(toDate) || fromDate > toDate) throw new DateTimeInputError("Rentang tanggal laporan tidak valid.");
  const from = parseWorkshopDateTime(`${fromDate}T00:00`);
  parseWorkshopDateTime(`${toDate}T00:00`);
  const toExclusive = parseWorkshopDateTime(`${nextCalendarDate(toDate)}T00:00`);
  return { from, toExclusive, fromDate, toDate };
}

export function workshopDateTimeInput(date: Date) {
  const parts = readParts(date, timezone());
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function workshopDateTimeDisplay(date: Date) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: timezone(), dateStyle: "medium", timeStyle: "short",
  }).format(date);
}
