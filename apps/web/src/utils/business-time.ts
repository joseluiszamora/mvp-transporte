const businessTimeZone = "America/La_Paz";

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: businessTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: businessTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function numericParts(value: Date, formatter: Intl.DateTimeFormat): Record<string, number> {
  return Object.fromEntries(
    formatter.formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function requirePart(parts: Record<string, number>, key: string): number {
  const value = parts[key];
  if (value === undefined || !Number.isInteger(value)) throw new RangeError("No se pudo resolver la fecha operativa.");
  return value;
}

export function businessDateKey(value: Date): string {
  const parts = numericParts(value, dateFormatter);
  return `${requirePart(parts, "year")}-${String(requirePart(parts, "month")).padStart(2, "0")}-${String(requirePart(parts, "day")).padStart(2, "0")}`;
}

export function businessDateTimeInput(value: Date = new Date()): string {
  const parts = numericParts(value, dateTimeFormatter);
  const year = requirePart(parts, "year");
  const month = requirePart(parts, "month");
  const day = requirePart(parts, "day");
  const hour = requirePart(parts, "hour");
  const minute = requirePart(parts, "minute");
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function businessDateTimeToIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(value);
  if (!match) throw new RangeError("La fecha y hora operativa no es válida.");
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? 0));
  if (year === undefined || month === undefined || day === undefined || hour === undefined || minute === undefined || second === undefined || year < 100 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    throw new RangeError("La fecha y hora operativa no es válida.");
  }
  const targetWallTime = Date.UTC(year, month - 1, day, hour, minute, second);
  const calendarDate = new Date(targetWallTime);
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
    throw new RangeError("La fecha y hora operativa no es válida.");
  }

  let instant = targetWallTime;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = numericParts(new Date(instant), dateTimeFormatter);
    const actualWallTime = Date.UTC(
      requirePart(actual, "year"), requirePart(actual, "month") - 1, requirePart(actual, "day"),
      requirePart(actual, "hour"), requirePart(actual, "minute"), requirePart(actual, "second"),
    );
    const adjustment = targetWallTime - actualWallTime;
    if (adjustment === 0) return new Date(instant).toISOString();
    instant += adjustment;
  }
  throw new RangeError("La hora no existe en el calendario operativo.");
}

export function addCalendarDays(dateKey: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dateKey);
  if (!match || !Number.isInteger(days)) throw new RangeError("La fecha operativa no es válida.");
  const [year, month, day] = match.slice(1).map(Number);
  if (year === undefined || month === undefined || day === undefined) throw new RangeError("La fecha operativa no es válida.");
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new RangeError("La fecha operativa no es válida.");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
