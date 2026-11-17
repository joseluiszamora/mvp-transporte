const BUSINESS_TIME_ZONE = "America/La_Paz";

const businessDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function businessDateKey(value: Date): string {
  const parts = businessDateFormatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new RangeError("No se pudo resolver la fecha operativa.");
  return `${year}-${month}-${day}`;
}

export function startOfBusinessDayUtc(value: Date): Date {
  return new Date(`${businessDateKey(value)}T00:00:00.000Z`);
}

export function addBusinessDays(value: Date, days: number): Date {
  const result = startOfBusinessDayUtc(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function addUtcCalendarDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
