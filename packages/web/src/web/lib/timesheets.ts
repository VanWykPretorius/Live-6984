export const timeLabel = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
export const projectLabel = (name: string) => name.replace(/^\d+[_ -]*/, "").replaceAll("_", " ");
export const farmToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());
