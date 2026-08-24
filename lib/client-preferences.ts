export const FAIRTURN_TIMEZONE_STORAGE_KEY = "fairturn:user-timezone";

const FALLBACK_TIMEZONES = [
  "UTC",
  "Africa/Cairo",
  "Africa/Casablanca",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  "America/Anchorage",
  "America/Argentina/Buenos_Aires",
  "America/Bogota",
  "America/Chicago",
  "America/Denver",
  "America/Halifax",
  "America/Lima",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/New_York",
  "America/Phoenix",
  "America/Sao_Paulo",
  "America/St_Johns",
  "America/Toronto",
  "America/Vancouver",
  "Asia/Bangkok",
  "Asia/Dhaka",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Jakarta",
  "Asia/Jerusalem",
  "Asia/Karachi",
  "Asia/Kathmandu",
  "Asia/Kolkata",
  "Asia/Manila",
  "Asia/Riyadh",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Taipei",
  "Asia/Tehran",
  "Asia/Tokyo",
  "Atlantic/Azores",
  "Australia/Adelaide",
  "Australia/Brisbane",
  "Australia/Darwin",
  "Australia/Hobart",
  "Australia/Melbourne",
  "Australia/Perth",
  "Australia/Sydney",
  "Europe/Amsterdam",
  "Europe/Athens",
  "Europe/Berlin",
  "Europe/Brussels",
  "Europe/Bucharest",
  "Europe/Dublin",
  "Europe/Helsinki",
  "Europe/Istanbul",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Moscow",
  "Europe/Paris",
  "Europe/Rome",
  "Europe/Stockholm",
  "Europe/Vienna",
  "Europe/Warsaw",
  "Pacific/Auckland",
  "Pacific/Fiji",
  "Pacific/Guam",
  "Pacific/Honolulu",
  "Pacific/Port_Moresby",
  "Pacific/Tahiti",
] as const;

function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

export function detectUserTimeZone() {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return detected && isValidTimeZone(detected) ? detected : "UTC";
}

export function listWorldTimeZones() {
  let supported: string[] = [];
  try {
    supported = Intl.supportedValuesOf("timeZone");
  } catch {
    supported = [...FALLBACK_TIMEZONES];
  }

  return Array.from(
    new Set(["UTC", detectUserTimeZone(), ...supported]),
  ).sort((left, right) => {
    if (left === "UTC") return -1;
    if (right === "UTC") return 1;
    return left.localeCompare(right);
  });
}

export function timeZoneOffsetLabel(timeZone: string, at = new Date()) {
  try {
    const offset = new Intl.DateTimeFormat("en", {
      timeZone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value;
    if (!offset || offset === "GMT" || offset === "UTC") return "UTC+0";
    return offset.replace(/^GMT/, "UTC").replace(/:00$/, "");
  } catch {
    return "UTC+0";
  }
}

export function timeZoneDisplayLabel(timeZone: string) {
  return `${timeZone} (${timeZoneOffsetLabel(timeZone)})`;
}

export function readPreferredTimeZone() {
  const detected = detectUserTimeZone();
  if (typeof window === "undefined") return detected;
  const stored = window.localStorage.getItem(FAIRTURN_TIMEZONE_STORAGE_KEY);
  return stored && isValidTimeZone(stored) ? stored : detected;
}

export function savePreferredTimeZone(timeZone: string) {
  if (typeof window === "undefined" || !isValidTimeZone(timeZone)) return;
  window.localStorage.setItem(FAIRTURN_TIMEZONE_STORAGE_KEY, timeZone);
}
