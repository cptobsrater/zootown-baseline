/**
 * Strict start-time validator for events.
 *
 * Enforces the user's standing instruction: "if you can't get solid
 * confidence on the start time, don't post it as an event."
 *
 * Returns one of:
 *   { ok: true, startsAt }       -> event passes, ingest publishes it
 *   { ok: false, reason }        -> quarantine the event for admin review
 *
 * The validator rejects if ANY of these are true:
 *   - startsAt is missing or unparseable
 *   - The raw time text contains red-flag phrases (TBD, see website,
 *     check social media, etc.) suggesting the parser made up a time
 *   - The parsed time is in the past (we'd surface a stale event)
 *   - The parsed time is at midnight EXACTLY -- a common parser
 *     fallback when the source didn't specify a time
 *
 * Each rejection sets a specific `reason` so the quarantine UI can
 * surface what went wrong.
 */

export interface ValidateInput {
  startsAt: string | null | undefined;
  // Free-text time field from the source. Optional.
  rawTimeText?: string | null;
  // Headline + summary, used to detect red-flag phrases in body copy too.
  headline?: string;
  summary?: string;
}

export type ValidateResult =
  | { ok: true; startsAt: string }
  | { ok: false; reason: string };

const RED_FLAG_PATTERNS: RegExp[] = [
  /\bto be (announced|determined)\b/i,
  /\btba\b/i,
  /\btbd\b/i,
  /\bsee (website|details)\b/i,
  /\bcheck (website|social media|facebook|instagram)\b/i,
  /\bvisit (the )?website for (time|details)\b/i,
  /\btime varies\b/i,
  /\bcontact for (time|details)\b/i,
  /\bsee (the )?(flyer|poster) for (time|details)\b/i,
];

/**
 * Heuristic: was the parser default a midnight value?
 *
 * Eventbrite and other sources sometimes return "2026-06-15T00:00:00" when
 * they fail to parse the time. A real-world event at midnight is rare, so
 * we treat it as a parser fallback rather than a confident timestamp.
 *
 * Exception: events whose source clearly said "midnight" or "12am" pass.
 *
 * IMPORTANT: "midnight" must be checked in the SOURCE's local timezone, not
 * UTC. A 6 PM Mountain Time event serializes as `2026-06-17T18:00:00-0600`
 * = UTC `2026-06-18T00:00:00Z`. Checking UTC hours would flag every
 * evening Montana event as a midnight fallback. We instead inspect the
 * raw ISO string for an explicit `T00:00:00` at the head of the time
 * portion -- only then is it actually local midnight.
 */
function looksLikeMidnightFallback(rawIso: string, raw?: string | null): boolean {
  // Match the time portion of an ISO 8601 string. We accept either Z or
  // an explicit offset (+HH:MM, -HHMM, etc.).
  const m = rawIso.match(/T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+\-]\d{2}:?\d{2})?$/);
  if (!m) return false;
  const localHour = Number(m[1]);
  const localMin = Number(m[2]);
  if (localHour !== 0 || localMin !== 0) return false;
  // Source-local midnight. Allow when the body text actually says
  // midnight / 12am / all day.
  if (!raw) return true;
  const r = raw.toLowerCase();
  if (/(midnight|12\s*am|12:00\s*am|all day|all-day)/i.test(r)) return false;
  return true;
}

export function validateEventTime(input: ValidateInput): ValidateResult {
  const raw = (input.rawTimeText ?? "").trim();
  // Check body copy for red-flag phrases.
  const bodyText = `${input.headline ?? ""} ${input.summary ?? ""} ${raw}`;
  for (const re of RED_FLAG_PATTERNS) {
    if (re.test(bodyText)) {
      return { ok: false, reason: `ambiguous_wording: ${re.source}` };
    }
  }

  if (!input.startsAt) {
    return { ok: false, reason: "no_time" };
  }

  const rawIso = input.startsAt;
  const parsed = new Date(rawIso);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, reason: "unparseable_time" };
  }

  // Past events: we shouldn't publish them to the calendar. 5-minute grace
  // covers race conditions during ingest.
  if (parsed.getTime() < Date.now() - 5 * 60 * 1000) {
    return { ok: false, reason: "past_date" };
  }

  // Midnight-fallback heuristic.
  if (looksLikeMidnightFallback(rawIso, raw)) {
    return { ok: false, reason: "midnight_fallback_local" };
  }

  return { ok: true, startsAt: parsed.toISOString() };
}
