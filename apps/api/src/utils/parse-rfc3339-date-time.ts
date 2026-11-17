import { ApiError } from "../errors.ts";

const rfc3339DateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/u;

export function parseRfc3339DateTime(value: unknown, label: string, optional = false): Date | null {
  if (optional && (value === undefined || value === null || value === "")) return null;
  if (typeof value !== "string") throw new ApiError(400, "INVALID_REQUEST", `${label} debe incluir fecha, hora y zona horaria.`);
  const match = rfc3339DateTimePattern.exec(value);
  if (!match) throw new ApiError(400, "INVALID_REQUEST", `${label} debe incluir fecha, hora y zona horaria.`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fractionalSecond = match[7] ?? "";
  const milliseconds = Math.floor(Number(`0.${fractionalSecond || "0"}`) * 1_000);
  const offsetSign = match[9];
  const offsetHours = Number(match[10] ?? 0);
  const offsetMinutes = Number(match[11] ?? 0);

  if (year < 100 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 ||
    offsetHours > 23 || offsetMinutes > 59 || (offsetSign === undefined && match[8] !== "Z")) {
    throw new ApiError(400, "INVALID_REQUEST", `${label} no es válida.`);
  }

  const calendarDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day ||
    calendarDate.getUTCHours() !== hour || calendarDate.getUTCMinutes() !== minute || calendarDate.getUTCSeconds() !== second) {
    throw new ApiError(400, "INVALID_REQUEST", `${label} no es válida.`);
  }

  const offsetMilliseconds = (offsetHours * 60 + offsetMinutes) * 60_000 * (offsetSign === "+" ? 1 : -1);
  return new Date(calendarDate.getTime() + milliseconds - offsetMilliseconds);
}
