export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function absoluteDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function absoluteDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatEventDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Format an event time range for the story detail view.
 *
 *   formatEventRange("2026-06-22T21:00Z")                   -> "Mon, Jun 22, 3:00 PM"
 *   formatEventRange("2026-06-22T21:00Z", "2026-06-22T23:00Z")
 *                                                           -> "Mon, Jun 22, 3:00 – 5:00 PM"
 *   formatEventRange("2026-06-22T21:00Z", "2026-06-23T01:00Z")
 *                                                           -> "Mon, Jun 22, 3:00 PM – Tue, Jun 23, 7:00 PM"
 *
 * Trims the AM/PM marker on the start time when start & end share the same
 * meridiem on the same day, which is the common case for venue/calendar events.
 */
export function formatEventRange(startIso: string, endIso?: string | null): string {
  const start = new Date(startIso);
  const startStr = start.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  if (!endIso) return startStr;
  const end = new Date(endIso);
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  if (!sameDay) {
    const endStr = end.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return `${startStr} – ${endStr}`;
  }
  const endStr = end.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  // Same day: collapse to "3:00 – 5:00 PM" when both share AM/PM marker.
  const startMeridiem = startStr.match(/(AM|PM)$/i)?.[1] ?? "";
  const endMeridiem = endStr.match(/(AM|PM)$/i)?.[1] ?? "";
  if (startMeridiem && startMeridiem.toUpperCase() === endMeridiem.toUpperCase()) {
    return `${startStr.replace(/\s*(AM|PM)$/i, "")} – ${endStr}`;
  }
  return `${startStr} – ${endStr}`;
}

export function parseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export const DESK_META = {
  city: {
    id: "city" as const,
    label: "City Desk",
    short: "City",
    description: "Official notices, meetings, public works, and civic policy.",
    color: "city" as const,
    letter: "C",
  },
  business: {
    id: "business" as const,
    label: "Business Desk",
    short: "Business",
    description: "Downtown activity, openings, closings, and the local economy.",
    color: "business" as const,
    letter: "B",
  },
  crime: {
    id: "crime" as const,
    label: "Crime Desk",
    short: "Crime",
    description: "Public safety — police, sheriff, courts, and neighborhood watch.",
    color: "crime" as const,
    letter: "R",
  },
  sports: {
    id: "sports" as const,
    label: "Sports Desk",
    short: "Sports",
    description: "Griz athletics, high school sports, recreation leagues, and races.",
    color: "sports" as const,
    letter: "S",
  },
  health: {
    id: "health" as const,
    label: "Health Desk",
    short: "Health",
    description: "Public health, hospitals and clinics, wellness, plus breakthroughs in medicine and health tech.",
    color: "health" as const,
    letter: "M",
  },
  entertainment: {
    id: "entertainment" as const,
    label: "Entertainment",
    short: "Entertainment",
    description: "Local live entertainment — music, shows, and the Missoula stage.",
    color: "entertainment" as const,
    letter: "E",
  },
  people: {
    id: "people" as const,
    label: "People",
    short: "People",
    description: "Profiles, interviews, and the stories of Missoula's neighbors and leaders.",
    color: "people" as const,
    letter: "W",
  },
  history: {
    id: "history" as const,
    label: "History",
    short: "History",
    description: "Missoula's past — founding stories, turning points, and the events that shaped the valley.",
    color: "history" as const,
    letter: "H",
  },
};

export type DeskId = keyof typeof DESK_META;

export function deskDotClass(desk: DeskId): string {
  return `bg-desk-${desk}`;
}

export function deskTextClass(desk: DeskId): string {
  return `desk-${desk}`;
}

export function deskBgClass(desk: DeskId): string {
  return `bg-desk-${desk}`;
}

// Political scope
export const POLITICAL_SCOPE_META = {
  local: {
    id: "local" as const,
    label: "Local",
    description: "Missoula, city wards, county, neighborhoods.",
  },
  state: {
    id: "state" as const,
    label: "State",
    description: "Montana Legislature, governor, statewide races and ballot measures.",
  },
  national: {
    id: "national" as const,
    label: "National",
    description: "Federal offices. Published sparingly, and only when relevant to Missoula voters.",
  },
};

export type PoliticalScope = keyof typeof POLITICAL_SCOPE_META;

export function scopeChipClass(scope: PoliticalScope): string {
  return `bg-scope-${scope} border-scope-${scope}`;
}
