// src/lib/special-days.js — v18.10.0
//
// ── Special days: a date's hours that differ from its weekday's ─────────────
// One date or a run of dates (Christmas, a private event, a holiday week) that
// is either CLOSED or open with its own hours, plus an optional short note
// ("Christmas") shown with the day (Patryk, 2026-10-18).
//
// Stored INSIDE `settings/operatingHours`, beside `days`, as
//   exceptions: { <id>: { from, to, closed, open, close, note } }
// so the node's rev pair and its `hoursEdit` rule cover it with no rules
// deploy. That is also why SCHEMA went 3 → 4: a device on an older build reads
// the node through a whitelist that has no `exceptions`, and its next weekday
// edit writes `{ days }` back without them.
//
// Read by `hoursFor(date)` (constants.js), through the date index this file
// builds (`exceptionIndex`), so every reader of a date's hours follows a special
// day by itself: new bookings, walk-ins, standing weeks, the waitlist, the
// WhatsApp draft check and the timeline's Closed notice.
//
// Saving one over bookings already made keeps them (Patryk): the editor names
// them and asks first (`affectedBookings`), and nothing moves or is cancelled.
//
// Imports nothing that imports constants.js, so constants.js can stay free of
// it: the hook builds the index and hands it to `setHourExceptions`.

import { addDays, formatDay, isReadableDate } from "./day.js";
import { hourLabel } from "./time-grid.js";
import { countLabel } from "./booking-logic.js";

// The opening-hours bounds every day obeys (v14.5.0): open 06–22, close an hour
// after opening at the earliest and 01:00 (25) at the latest. sanitizeDay in
// useOperatingHours reads the same function, so a special day and a weekday can
// never disagree about what an hour may be.
export function clampHours(open, close) {
  let o = Math.round(Number(open));
  let c = Math.round(Number(close));
  if (!Number.isFinite(o)) o = 13;
  if (!Number.isFinite(c)) c = 22;
  o = Math.max(6, Math.min(22, o));
  c = Math.max(o + 1, Math.min(25, c));
  return { open: o, close: c };
}

// The longest run one special day may cover: a summer closure of a few weeks
// fits, a typo of a year does not.
export const SPECIAL_MAX_DAYS = 92;
// The note is a label for a day ("Christmas", "Private event"), not a message.
export const SPECIAL_NOTE_MAX = 60;
// How long a special day stays listed (greyed, under "Past") after its last
// date, before the next save of the hours drops it.
export const SPECIAL_KEEP_DAYS = 30;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
// A real calendar date in the stored shape: "2026-02-31" has the shape and is
// not one (stepping it by nothing gives back another date).
const isIso = (v) => {
  if (typeof v !== "string" || !ISO_RE.test(v) || !isReadableDate(v)) return false;
  try { return addDays(v, 0) === v; } catch { return false; }
};

// How many dates a run covers, `from` and `to` included.
function spanDays(from, to) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
}

// One stored special day, or null when it cannot be read as one. Lenient the
// way a reader must be: a missing or earlier `to` reads as the one date, a run
// longer than the cap is cut to it.
export function sanitizeException(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!isIso(raw.from)) return null;
  const from = raw.from;
  let to = isIso(raw.to) && raw.to >= from ? raw.to : from;
  if (spanDays(from, to) > SPECIAL_MAX_DAYS) to = addDays(from, SPECIAL_MAX_DAYS - 1);
  const h = clampHours(raw.open, raw.close);
  const note = typeof raw.note === "string" ? raw.note.replace(/\s+/g, " ").trim().slice(0, SPECIAL_NOTE_MAX) : "";
  return { from, to, closed: raw.closed === true, open: h.open, close: h.close, note };
}

// The `exceptions` child, cleaned. Keys are ids (`genId()`), path-safe.
export function sanitizeExceptions(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  Object.keys(raw).sort().forEach((id) => {
    if (!ID_RE.test(id)) return;
    const ex = sanitizeException(raw[id]);
    if (ex) out[id] = ex;
  });
  return out;
}

// Every date a special day covers.
export function datesOf(ex) {
  const out = [];
  for (let d = ex.from; d <= ex.to && out.length < SPECIAL_MAX_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
}

// { "YYYY-MM-DD": { id, from, to, closed, open, close, note } } — what
// `hoursFor` looks a date up in. Two that overlap (the editor refuses it, but
// two devices can each save one) resolve the same way everywhere: the one that
// starts earlier, then the smaller id.
export function exceptionIndex(exceptions) {
  const idx = {};
  Object.keys(exceptions || {})
    .map((id) => Object.assign({ id }, exceptions[id]))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .forEach((ex) => { datesOf(ex).forEach((d) => { if (!idx[d]) idx[d] = ex; }); });
  return idx;
}

// The other special day a draft would share a date with, or null.
export function overlapOf(exceptions, draft, ignoreId) {
  const ids = Object.keys(exceptions || {}).sort();
  for (const id of ids) {
    if (id === ignoreId) continue;
    const ex = exceptions[id];
    if (draft.from <= ex.to && draft.to >= ex.from) return Object.assign({ id }, ex);
  }
  return null;
}

// "Thu 24.12" or "Thu 24.12 – Sat 26.12".
export function rangeLabel(ex, today) {
  const o = today ? { today } : undefined;
  return ex.from === ex.to ? formatDay(ex.from, o) : formatDay(ex.from, o) + " – " + formatDay(ex.to, o);
}

// "Closed" or "18:00–23:00".
export function specialHoursLabel(ex) {
  return ex.closed ? "Closed" : hourLabel(ex.open) + "–" + hourLabel(ex.close);
}

// Why a draft cannot be saved, as the sentence the editor shows, or null.
// `ignoreId` is the special day being edited, which may overlap itself.
export function specialDayRefusal(draft, exceptions, ignoreId, today) {
  if (!draft || !isIso(draft.from)) return "Choose the first date.";
  if (!isIso(draft.to)) return "Choose the last date.";
  if (draft.to < draft.from) return "The last date is before the first.";
  if (spanDays(draft.from, draft.to) > SPECIAL_MAX_DAYS) return "At most " + countLabel(SPECIAL_MAX_DAYS, "day", "days") + " at a time.";
  if (today && draft.to < today) return "Those dates have passed.";
  if (!draft.closed) {
    const h = clampHours(draft.open, draft.close);
    if (h.open !== Number(draft.open) || h.close !== Number(draft.close)) return "Opening is 06:00–22:00, closing at least an hour later and by 01:00.";
  }
  const clash = overlapOf(exceptions, draft, ignoreId);
  if (clash) return "These dates overlap another special day (" + rangeLabel(clash, today) + "). Change that one instead.";
  return null;
}

function startMins(t) {
  const p = typeof t === "string" ? t.split(":") : [];
  const m = Number(p[0]) * 60 + Number(p[1]);
  return Number.isFinite(m) ? m : null;
}

// Bookings already made that a special day leaves outside the hours: on a
// closed run, every one still to happen (pending, confirmed, seated); on an
// open run, those starting before it opens or after its last start (closing
// less 15 minutes, the form's own rule, `lastStartMins`). Sorted by date and
// time. They are KEPT; this is what the editor names before saving.
export function affectedBookings(bookings, ex) {
  if (!ex || !Array.isArray(bookings)) return [];
  const lastStart = Math.min(ex.close, 24) * 60 - 15;
  return bookings
    .filter((b) => b && b.date >= ex.from && b.date <= ex.to && b.status !== "cancelled" && b.status !== "completed")
    .filter((b) => {
      if (ex.closed) return true;
      const m = startMins(b.time);
      return m === null || m < ex.open * 60 || m > lastStart;
    })
    .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : a.date + a.time > b.date + b.time ? 1 : 0));
}

// Special days whose last date is more than SPECIAL_KEEP_DAYS before today are
// dropped. Returns its input when nothing goes, so a save that drops nothing
// diffs as nothing.
export function pruneExceptions(exceptions, today) {
  if (!isIso(today)) return exceptions;
  const cut = addDays(today, -SPECIAL_KEEP_DAYS);
  const keep = {};
  let dropped = false;
  Object.keys(exceptions || {}).forEach((id) => {
    if (exceptions[id].to < cut) dropped = true; else keep[id] = exceptions[id];
  });
  return dropped ? keep : exceptions;
}

// For the Settings list: { upcoming, past }, each [{id, …}], upcoming by first
// date, past most recent first. "Past" = the last date is before today.
export function splitExceptions(exceptions, today) {
  const all = Object.keys(exceptions || {}).map((id) => Object.assign({ id }, exceptions[id]));
  const upcoming = all.filter((e) => e.to >= today).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const past = all.filter((e) => e.to < today).sort((a, b) => (a.to > b.to ? -1 : a.to < b.to ? 1 : 0));
  return { upcoming, past };
}
