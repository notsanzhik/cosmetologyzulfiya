import { catalog, settings, localDate, type Procedure } from "../src/shared";

export class AppError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
const MIN = 60_000;
export function selectedProcedures(ids: unknown): Procedure[] {
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 10 ||
    new Set(ids).size !== ids.length ||
    ids.some((x) => typeof x !== "string")
  )
    throw new AppError("invalid");
  const list = ids.map((id) =>
    catalog.procedures.find((p) => p.id === id && p.enabled),
  );
  if (list.some((x) => !x)) throw new AppError("invalid");
  const procedures = list as Procedure[];
  if (
    procedures.some(
      (p) =>
        !Number.isSafeInteger(p.duration) || p.duration <= 0 ||
        p.duration % settings.slotMinutes !== 0 ||
        ![undefined, "fixed", "from", "on_request"].includes(p.priceType) ||
        (p.price === null
          ? p.priceType !== "on_request"
          : !Number.isSafeInteger(p.price) || p.price < 0 || p.priceType === "on_request"),
    )
  )
    throw new AppError("setup", 503);
  if (
    procedures.reduce((n, p) => n + p.duration, 0) > settings.maxDurationMinutes
  )
    throw new AppError("tooLong");
  return procedures;
}
// Используем IANA-зону, а не часовой пояс компьютера клиента.
// Смещение вычисляется для конкретной даты; текущий UTC+5 не зашит в код.
export function zonedEpoch(date: string, time: string): number {
  const target = Date.parse(`${date}T${time}:00Z`);
  let result = target;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: settings.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(result));
    const p = (key: string) => parts.find((x) => x.type === key)!.value;
    const observed = Date.parse(
      `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}:${p("second")}Z`,
    );
    result += target - observed;
  }
  return result;
}
export function validDate(date: string, now = Date.now()) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  )
    throw new AppError("invalid");
  if (
    date < localDate(now) ||
    date > localDate(now + settings.maxAdvanceDays * 86400000)
  )
    throw new AppError("expired");
}
export function candidateSlots(
  date: string,
  duration: number,
  now = Date.now(),
) {
  validDate(date, now);
  if (settings.holidays.includes(date)) return [];
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const windows = settings.workingHours[
    String(weekday) as keyof typeof settings.workingHours
  ] as string[][];
  const times: number[] = [];
  for (const [open, close] of windows) {
    const start = zonedEpoch(date, open),
      end = zonedEpoch(date, close);
    for (
      let at = start;
      at + (duration + settings.bufferMinutes) * MIN <= end;
      at += settings.slotMinutes * MIN
    ) {
      if (at >= now + settings.minLeadMinutes * MIN) times.push(at);
    }
  }
  return [...new Set(times)].sort((a, b) => a - b);
}
export function occupiedSegments(start: number, duration: number) {
  const result: number[] = [];
  for (
    let at = start;
    at < start + (duration + settings.bufferMinutes) * MIN;
    at += settings.slotMinutes * MIN
  )
    result.push(at);
  return result;
}
export function availableSlots(
  date: string,
  duration: number,
  busy: Set<number>,
  now = Date.now(),
) {
  return candidateSlots(date, duration, now).map((start) => ({
    start,
    available: occupiedSegments(start, duration).every((x) => !busy.has(x)),
  }));
}
