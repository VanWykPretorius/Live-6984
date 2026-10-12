import { addDays } from "./xero";

export type ScheduleInput = {
  startDate: string;
  frequency: string;
  status: string;
  pauseFrom?: string | null;
  pauseTo?: string | null;
};

export function stepDays(frequency: string): number {
  return frequency === "biweekly" ? 14 : 7;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/**
 * A pause with an end date that has already passed is over: the cadence is billing again,
 * so the row should not keep reporting itself as paused.
 */
export function pauseHasExpired(sub: ScheduleInput, today: string): boolean {
  return sub.status === "paused" && Boolean(sub.pauseTo) && today > (sub.pauseTo as string);
}

/** True when the subscription is paused (or cancelled) on that date. */
export function isPausedOn(sub: ScheduleInput, date: string): boolean {
  if (sub.status === "cancelled") return true;
  if (sub.status !== "paused") return false;
  if (!sub.pauseFrom && !sub.pauseTo) return true; // paused indefinitely
  if (sub.pauseFrom && date < sub.pauseFrom) return false;
  if (sub.pauseTo && date > sub.pauseTo) return false;
  return true;
}

/** Every delivery date the cadence lands on inside [from, to], pause windows removed. */
export function deliveryDatesInRange(sub: ScheduleInput, from: string, to: string): string[] {
  if (sub.status === "cancelled") return [];
  const step = stepDays(sub.frequency);
  const dates: string[] = [];
  let cursor = sub.startDate;
  if (cursor < from) {
    const diff = daysBetween(sub.startDate, from);
    cursor = addDays(sub.startDate, Math.ceil(diff / step) * step);
  }
  let guard = 0;
  while (cursor <= to && guard++ < 500) {
    if (!isPausedOn(sub, cursor)) dates.push(cursor);
    cursor = addDays(cursor, step);
  }
  return dates;
}

/** Next delivery on or after `from`, skipping pause windows (null if none within a year). */
export function nextDeliveryDate(sub: ScheduleInput, from: string): string | null {
  if (sub.status === "cancelled") return null;
  const horizon = addDays(from, 400);
  const dates = deliveryDatesInRange(sub, from, horizon);
  return dates[0] ?? null;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Monday-to-Sunday week containing `date`. */
export function weekRange(date: string): { from: string; to: string } {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  const from = addDays(date, -dow);
  return { from, to: addDays(from, 6) };
}

/**
 * The Thursday the invoice for `date` falls on: that date if it is already a Thursday,
 * otherwise the next one. Weeks therefore run Friday-to-Thursday, so a Friday or weekend
 * order bills on the upcoming Thursday and an invoice is never dated before its order.
 */
export function thursdayOfWeek(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday, 4 = Thursday
  return addDays(date, (4 - dow + 7) % 7);
}
