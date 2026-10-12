export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `R ${value.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function shortDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const text = iso instanceof Date ? iso.toISOString() : iso;
  const [y, m, d] = text.slice(0, 10).split("-");
  if (!y || !m || !d) return text;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
}

export function dayName(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const text = iso instanceof Date ? iso.toISOString() : iso;
  const d = new Date(`${text.slice(0, 10)}T00:00:00Z`);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekRange(iso: string): { from: string; to: string } {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  const from = addDays(iso, -dow);
  return { from, to: addDays(from, 6) };
}

/** Trigger a browser download of CSV text. */
export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) return String((err as Error).message);
  return "Something went wrong";
}
