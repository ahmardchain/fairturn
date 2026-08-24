const weekdayNumbers: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    minute: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    day: "2-digit",
    month: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    minute: Number(values.minute),
    hour: Number(values.hour),
    day: Number(values.day),
    month: Number(values.month),
    weekday: weekdayNumbers[values.weekday] ?? -1,
  };
}

function cronFieldMatches(field: string, value: number) {
  return field.split(",").some((part) => {
    if (part === "*") return true;
    const step = part.match(/^\*\/(\d+)$/u);
    if (step) return value % Number(step[1]) === 0;
    const range = part.match(/^(\d+)-(\d+)$/u);
    if (range) return value >= Number(range[1]) && value <= Number(range[2]);
    return Number(part) === value;
  });
}

export function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function nextScheduledRun(input: {
  cronExpression: string;
  timezone: string;
  scheduleKind: string;
  after: string;
}) {
  if (input.scheduleKind === "once") return null;
  const fields = input.cronExpression.trim().split(/\s+/u);
  if (fields.length !== 5 || !isValidTimezone(input.timezone)) return null;
  const cursor = new Date(input.after);
  if (Number.isNaN(cursor.getTime())) return null;
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  const searchMinutes =
    input.scheduleKind === "weekly" ? 8 * 24 * 60 : 26 * 60;

  for (let offset = 0; offset < searchMinutes; offset += 1) {
    const parts = localParts(cursor, input.timezone);
    if (
      cronFieldMatches(fields[0], parts.minute) &&
      cronFieldMatches(fields[1], parts.hour) &&
      cronFieldMatches(fields[2], parts.day) &&
      cronFieldMatches(fields[3], parts.month) &&
      cronFieldMatches(fields[4], parts.weekday)
    ) {
      return cursor.toISOString();
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return null;
}

export function nextRecurringRun(input: {
  cronExpression: string;
  timezone: string;
  scheduleKind: string;
  after: string;
}) {
  if (input.scheduleKind === "once") return null;
  return nextScheduledRun(input);
}
