export function formatNumber(value: number): string {
  return new Intl.NumberFormat("es-BO", { maximumFractionDigits: 2 }).format(value);
}

export function formatDate(value: string): string {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  return new Intl.DateTimeFormat("es-BO", { dateStyle: "medium" }).format(date);
}
