// src/lib/day.js
//
// v17.16.2 — the app's answer to two questions it had never answered once:
// **what day is it**, and **how do "now" and a booking share an axis**.
//
// The app keeps time in two units that look interchangeable and are not.
// `nowMins` is minutes since LOCAL midnight of today (useNowMins, via
// `getHours()*60+getMinutes()`). `toMins(b.time)` is minutes since midnight of
// **`b.date`**. They are the same number only while `b.date === today`; the
// moment they differ, every `nowMins - toMins(b.time)` in the codebase is
// subtracting two readings taken from different rulers.
//
// Where a `b.date === today` filter happened to sit in front of the arithmetic
// the result was a silent omission. Where it did not, the result was a wrong
// number that reached the database — a party seated at 00:30 off a 23:30
// booking persisted `duration: 1440`, and their table read as FREE to the
// walk-in form (crash-test CT-2B-01 / CT-2B-02).
//
// Exactly one function in the repo got this right: `pastCloseMins`, module-
// private inside `usePersistence.js`, which projects now onto the booking's own
// axis with `dayDiff*1440 + nowMins`. `nowOn` below is that expression, made
// public. `pastCloseMins` is now two lines over it (in booking-logic.js, which
// can take the `hoursFor` live binding this file must not).
//
// ── This file imports NOTHING, and that is load-bearing ──────────────────────
// `constants.js` needs `todayStr()` for `EMPTY_FORM`, and `booking-logic.js`
// imports `constants.js`. Anything imported here could close that loop. Keep it
// dependency-free; if a helper needs a live binding, it belongs in
// booking-logic.js instead.

// ── v18.15.0: the RESTAURANT's clock, not the device's ───────────────────────
// Until this version every reading of "now" asked the DEVICE (`getHours()`,
// `getDate()`), which is only the restaurant's clock while the device sits in
// the restaurant's zone. A phone in Poland (an hour ahead of the Canaries all
// year) drew the now-line an hour late, raised late warnings an hour early, and
// — the part that reached the database — had auto-extend stretch every seated
// party by the hour it believed had passed. West of the Canaries, a walk-in in
// the evening was filed under yesterday.
//
// A booking's own `date` + `time` are a WALL-CLOCK pair with no zone, which is
// right: 20:00 means 20:00 at the restaurant, wherever it is read. What had to
// change is every reading of an INSTANT (now, a stored `at`) into a wall clock.
// That now happens here and only here: `wallClock(instant)` gives the
// restaurant's date and time for an instant, and every helper below is built
// on it. `tests/clock-reads.test.js` fails a local getter anywhere else.
//
// The zone is set, not imported (this file imports nothing): `main.jsx` sets
// the tenant's `profile.timeZone` before the first render, and
// `useGeneralSettings` sets `settings/general.timeZone` when it loads, so no
// render ever reads the device's zone by accident. UNSET (null) means the
// device's zone, which is what every test that does not set one gets, and is
// exactly the behaviour before this version.
let ZONE = null;

// Is `tz` a zone this engine can format in? A typo, an empty string or a zone
// the engine has never heard of answers false, and `setTimeZone` then falls
// back to the device's zone rather than throwing from inside a render.
export function isValidTimeZone(tz) {
  if (typeof tz !== "string" || tz === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Returns the zone actually in force (null = the device's), so a caller can
// tell an accepted zone from a rejected one.
export function setTimeZone(tz) {
  ZONE = isValidTimeZone(tz) ? tz : null;
  return ZONE;
}

// The zone in force, or null for the device's own.
export function timeZone() {
  return ZONE;
}

// The device's own zone, for the header's "whose clock is this" label. null
// when the engine will not say.
export function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

// One formatter per zone: building an Intl.DateTimeFormat is the expensive
// part, and the app formats in one zone all day.
const FORMATTERS = new Map();
function formatterFor(tz) {
  let f = FORMATTERS.get(tz);
  if (!f) {
    // `hourCycle: "h23"`, never `hour12: false`: the latter prints midnight as
    // "24" in some engines, which would read as 1440 minutes.
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", weekday: "short",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
    });
    FORMATTERS.set(tz, f);
  }
  return f;
}
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// A one-entry cache, keyed on the zone and the MINUTE. "Now" is read many times
// per render (every booking's late state, the now-line, `todayStr()` in a
// dozen places) and always lands in the same minute, so this turns all of those
// into one `formatToParts`. Minute precision is safe because every real zone's
// offset is a whole number of minutes, and nothing here reports seconds.
let lastKey = null;
let lastClock = null;

// The wall clock at the restaurant for an instant: `{y, m, d, h, min, dow}`,
// month 1–12, weekday 0 = Sunday. `now` is a Date, a millisecond count, or
// absent for the current instant. `tz` overrides the zone in force (the server
// passes the restaurant's explicitly; `undefined` means "the one set").
//
// An invalid instant answers NaN in every field, as the local getters did, so a
// caller that formatted garbage before formats the same garbage now rather
// than throwing (`formatToParts` throws a RangeError on an Invalid Date).
export function wallClock(now, tz) {
  const d = now == null ? new Date() : (now instanceof Date ? now : new Date(now));
  const t = d.getTime();
  const zone = tz === undefined ? ZONE : (isValidTimeZone(tz) ? tz : null);
  if (!Number.isFinite(t)) return { y: NaN, m: NaN, d: NaN, h: NaN, min: NaN, dow: NaN };
  if (!zone) {
    // The device's zone: the getters this version replaced, verbatim.
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), min: d.getMinutes(), dow: d.getDay() };
  }
  const key = zone + "|" + Math.floor(t / 60000);
  if (key === lastKey) return lastClock;
  const out = { y: 0, m: 0, d: 0, h: 0, min: 0, dow: 0 };
  for (const p of formatterFor(zone).formatToParts(d)) {
    if (p.type === "year") out.y = Number(p.value);
    else if (p.type === "month") out.m = Number(p.value);
    else if (p.type === "day") out.d = Number(p.value);
    else if (p.type === "hour") out.h = Number(p.value) % 24;
    else if (p.type === "minute") out.min = Number(p.value);
    else if (p.type === "weekday") out.dow = DOW[p.value];
  }
  lastKey = key;
  lastClock = out;
  return out;
}

// Minutes since the restaurant's midnight, now (or at `now`). The `nowMins`
// every view and effect works in: `useNowMins` ticks it.
export function nowMinutes(now) {
  const c = wallClock(now);
  return c.h * 60 + c.min;
}

// "HH:MM" at the restaurant for an instant: a stored `at`, a message's `ts`.
// "" for anything that is not an instant, so a row with no stamp shows nothing
// rather than "NaN:NaN".
export function clockTime(at) {
  if (at == null || at === "") return "";
  const c = wallClock(at);
  if (!Number.isFinite(c.h)) return "";
  return String(c.h).padStart(2, "0") + ":" + String(c.min).padStart(2, "0");
}

// The zone's offset from UTC at an instant, in minutes (Canary summer: 60).
// From the wall clock itself, so it agrees with `wallClock` by construction.
// NaN for an invalid instant.
export function zoneOffsetMinutes(at, tz) {
  const t = at == null ? Date.now() : (at instanceof Date ? at.getTime() : new Date(at).getTime());
  if (!Number.isFinite(t)) return NaN;
  const c = wallClock(t, tz);
  return (Date.UTC(c.y, c.m - 1, c.d, c.h, c.min) - Math.floor(t / 60000) * 60000) / 60000;
}

// The INSTANT a wall-clock time at the restaurant names — the inverse of
// `wallClock`. Two passes, because the offset to use is the one in force AT the
// answer, which the first guess may sit on the wrong side of a clock change
// from. A time that does not exist (inside a spring-forward gap) lands after
// the gap; one that exists twice (an autumn hour) takes the first.
export function wallToInstant(y, m, d, h, min) {
  if (!ZONE) return new Date(y, m - 1, d, h, min).getTime();
  const guess = Date.UTC(y, m - 1, d, h, min);
  const first = guess - zoneOffsetMinutes(guess, ZONE) * 60000;
  return guess - zoneOffsetMinutes(first, ZONE) * 60000;
}

// v17.16.2 (CT-2B-03): TODAY, in the local timezone.
//
// This replaces 44 copies of `new Date().toISOString().slice(0,10)`, which
// answers a different question: the date in **UTC**. The app's clock is local
// (`getHours()`), so in any zone east of UTC the two disagree for the first
// hours of every local day — and Me Gustas Tú is in the Canaries, which are
// WEST (UTC+1) from March to October. Between local 00:00 and 01:00 all summer,
// the app believed "today" was yesterday: the Today button landed on the wrong
// day, today-only banners keyed to the wrong date, `optimizerActiveFor`'s
// today-vs-future branch inverted, and a walk-in or waitlist entry created in
// that hour was FILED under yesterday.
//
// The rest of the app's UTC date handling is correct and must not be swept up
// with this: a date-only string like "2026-08-31" parses as UTC midnight, so
// `new Date(dateStr).getUTCDay()` is the right weekday and `Date.parse` on two
// such strings is exactly a whole number of days apart (see `dayDiff`). Only
// deriving today from the current INSTANT was ever wrong.
//
// `now` is a testability seam and takes a Date representing an INSTANT. Do NOT
// pass a date-only string: that parses as UTC midnight, which lands on the
// PREVIOUS local day in any zone west of UTC, i.e. it reintroduces the bug this
// function exists to remove.
//
// v18.15.0: "local" now means the RESTAURANT's zone (`wallClock`, above), and
// the device's only while no zone is set.
export function todayStr(now) {
  const c = wallClock(now || new Date());
  return String(c.y) + "-" +
    String(c.m).padStart(2, "0") + "-" +
    String(c.d).padStart(2, "0");
}

// Whole days FROM `fromDateStr` TO `toDateStr` — positive when `to` is later.
//
// Both arguments are date-only strings ("YYYY-MM-DD"), which JS parses as UTC
// midnight. That is what makes this immune to DST: both endpoints move by the
// same zero offset, so a difference spanning a clock change is still an exact
// multiple of 86400000. Using LOCAL midnights here would make one spring day
// 23 hours long and round to 0. The `Math.round` is therefore not fixing a
// fractional day — it is a guard for a caller that hands over a full timestamp.
//
// Returns NaN for an unparseable date, honestly rather than defensively:
// `sanitize` guarantees `date` is a string and never that it is well-formed
// (crash-test CT-2A-03), so bad input is reachable — and a caller about to
// write a derived number to the database must check it there, where the refusal
// can be meaningful, rather than reading a plausible 0 from here.
export function dayDiff(fromDateStr, toDateStr) {
  return Math.round((Date.parse(toDateStr) - Date.parse(fromDateStr)) / 86400000);
}

// v17.16.2: `dateStr` moved by `n` whole days — the ONLY correct way to step
// the viewed date, and not the way the app was doing it.
//
// The four date-navigation sites (the two arrows in the header, the two arrow
// KEYS) hand-rolled `new Date(viewDate); d.setDate(d.getDate() + n)`. That mixes
// rulers exactly like the bug above: `new Date(dateStr)` is UTC midnight, while
// `setDate`/`getDate` read and write LOCAL components. On the spring-forward day
// the local day is 23 hours long, so +1 local day lands BEFORE the next UTC
// midnight and `toISOString().slice(0,10)` reads back the day you started on.
//
// Measured in Atlantic/Canary: `2026-03-29 → next` returned **2026-03-29**. The
// Next-day button and the → key did nothing at all on that date, once a year.
//
// Staying in UTC on both sides is what makes it exact, and it is the pattern the
// rest of the app already used — the recurring-occurrence generator and every
// WeekView grid step with `setUTCDate`, which is why none of THOSE drift. This
// function is WeekView's own private `addDays`, moved out: the correct
// implementation was the hidden one while the broken copy was the public
// behaviour.
//
// v17.16.11 splits the arithmetic out into `stepUTC` below and leaves this the
// strict public face it has always been. Every input the tests pin behaves
// identically; the two that changed were both already broken, and are described
// at `stepUTC`.
export function addDays(dateStr, n) {
  const out = stepUTC(dateStr, n);
  if (out === null) throw new RangeError("Invalid time value");
  return out;
}

// v17.16.11: the step, WITHOUT the throw — null when the answer cannot be a
// "YYYY-MM-DD" date. Module-private, because a caller wanting the strict answer
// wants `addDays` and a caller wanting the safe one wants `stepDate`; a third
// spelling of the same arithmetic is what this exists to prevent.
//
// It rejects on three grounds and each was measured, not reasoned about:
//   - the input does not parse at all (`""`, `"31/08/2026"`, `"not-a-date"`,
//     `"20260803"`) — `toISOString()` on an Invalid Date throws;
//   - the STEP falls off the representable range: `"275760-09-13"` parses fine
//     and `+1` day throws, so guarding the input alone is not enough;
//   - the step lands outside years 0001-9999, where `toISOString()` switches to
//     the expanded `±YYYYYY` form and `slice(0,10)` returns a truncated string
//     that is not a date. `addDays("9999-12-31", 1)` used to return the garbage
//     `"+010000-01"`; it throws now, which is the honest answer and is why this
//     tests the OUTPUT rather than trusting the range check above it.
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
function stepUTC(dateStr, n) {
  if (typeof dateStr !== "string") return null;
  const d = new Date(dateStr);
  if (!Number.isFinite(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + n);
  if (!Number.isFinite(d.getTime())) return null;
  const out = d.toISOString().slice(0, 10);
  return YMD_RE.test(out) ? out : null;
}

// v17.16.11: can the app NAVIGATE from this date — the consumer's requirement,
// not a format of its own, which is the shape `isReadableTime` established in
// v17.16.5 and `isReadableBlock` in v17.16.6. It is defined AS the thing it
// guards (a zero-day step succeeding), so the predicate and the operation
// cannot drift apart the way two hand-written rules would.
//
// Deliberately NOT a `^\d{4}-\d{2}-\d{2}$` pattern: `"2026-8-3"` parses and
// steps, so it navigates today and must keep navigating. Nothing that currently
// works may move — the rule `isReadableTime` was written under, where `"9:30"`
// is kept for exactly the same reason.
export function isReadableDate(v) {
  return stepUTC(v, 0) !== null;
}

// ── v18.0.0 session 10 (/code-review): one LOCAL day, as milliseconds ────────
// Local midnight to local midnight — the range the activity log's feed queries,
// because `at` is a wall-clock stamp and the restaurant thinks in local days.
//
// It lives here, with a NULL for a day it cannot express, because the call site
// is the app's only Firebase QUERY and `startAt(NaN)` THROWS rather than
// returning nothing — from inside an effect, where the error boundary answers
// by unmounting the app. Measured live: clearing the log's "Day to show" field
// gave `startAt failed: value argument contains NaN in property 'activity'` and
// the error screen, from one keystroke.
//
// `isReadableDate` is NOT sufficient on its own and the second guard is not
// ceremony: that predicate deliberately accepts anything `new Date` can step,
// so `"2026-8-3"`, `"2026/09/13"` and `"Sep 13 2026"` all pass it — and all
// three become NaN the moment `"T00:00:00"` is appended, because that suffix
// only makes sense on an ISO date (measured, node 24). Defined by its OUTPUT,
// the way `stepUTC` is, rather than by a format it hopes covers the inputs.
//
// v18.15.0: the RESTAURANT's midnight to its next one (`wallToInstant`), so the
// log shows the restaurant's day on a device in another zone. The accepted
// inputs are unchanged: only a "YYYY-MM-DD" with a month 1–12 and a day 1–31,
// which is exactly what the `"T00:00:00"` parse accepted (it rolls 02-30 over
// to March the same way `Date.UTC` does). The end is the NEXT midnight rather
// than `from + 24 h`, so a clock-change day is 23 or 25 hours long, as it is.
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function dayRangeMs(dateStr) {
  if (!isReadableDate(dateStr)) return null;
  const m = DAY_RE.exec(dateStr);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const from = wallToInstant(y, mo, d, 0, 0);
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  const to = wallToInstant(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0) - 1;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return { from: from, to: to };
}

// v17.16.11: `addDays` for the four sites that step the VIEWED date, anchoring
// to today when the date they were handed cannot be stepped.
//
// `viewDate` is not always app-controlled. `SearchPanel`'s onPick calls
// `goToDate(b.date)` with a booking's STORED date, and `searchBookings` filters
// on name, phone and `anonymized` — never on whether the date is a date. So one
// booking holding `date: ""` (a shape `sanitize` itself emits, and one the
// security rules accept deliberately) put an unparseable string into `viewDate`,
// and the next press of the arrow keys or the header chevrons threw out of
// `addDays` and unmounted the whole app into the v17.16.0 ErrorBoundary.
//
// Anchoring on today rather than refusing the step is the point: the bad booking
// stays reachable so somebody can go and repair it (the v17.16.6 BlockModal
// rule), while the arrows walk you back out to a real day. A silent no-op was
// the other option and is exactly the shape v17.16.2 removed, where forward
// navigation quietly died once a year.
export function stepDate(dateStr, n) {
  const out = stepUTC(dateStr, n);
  return out !== null ? out : addDays(todayStr(), n);
}

// v18.0.0 session 7: the weekday, abbreviated, for the date fields that show it
// inside the pill — "Fri 11/09/2026" (`DateField`, atoms.jsx). A native
// <input type="date"> cannot show one, and staff check which day they are on by
// its weekday.
//
// "" for anything that is not a CANONICAL date, which is exactly the set the
// native input refuses to display: a field showing no date must show no weekday.
// Canonical is `stepUTC(v, 0) === v` — the same test `openNew` relies on via
// `stepDate(d, 0) === d` — so "2026-8-3" (which navigates, see isReadableDate)
// and "2026-02-30" (which rolls over) both read "", because the input beside
// them is blank. All-UTC like everything else in this file.
//
// Exported (/code-review): the Reminders summary and the standing-booking rows
// read it rather than keeping their own byte-identical copies.
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// v18.0.0 session 8: the LONG list, for the same reason and two versions later.
// Session 7 consolidated the short one; the long one was in FOUR places —
// `DaySheet`'s `WD`, `BookingFormModal`'s `WEEKDAY_NAMES`, an inline copy in
// that SAME file's closed-day banner, and another inline copy in `doSave`. A
// named constant and an inline copy of it in one file is the shape this repo
// keeps finding: the copy that drifts is the one nobody is looking at.
//
// The LIST only, deliberately — not a `weekdayLong()` to match `weekdayShort()`.
// Its callers disagree about what an unreadable date should do (`weekdayShort`
// returns "" for anything non-canonical, `DaySheet` prints "" only for an
// unparseable one, and `doSave` falls back to "that day"), and those are
// three considered answers rather than three copies of one. Sharing the DATA
// removes the duplication; sharing the lookup would change behaviour in a print
// sheet under cover of a tidy-up.
export const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function weekdayShort(dateStr) {
  // The typeof is NOT redundant with stepUTC's own: stepUTC(null) returns null,
  // which is `===` the input, and `new Date(null)` is the epoch — a Thursday. The
  // test caught exactly that.
  if (typeof dateStr !== "string" || stepUTC(dateStr, 0) !== dateStr) return "";
  return WEEKDAY_SHORT[new Date(dateStr).getUTCDay()];
}

// ── v18.2.0 (the design critique, C1): ONE way to write a day ────────────────
// "Thu 24.09", and "Thu 24.09.2027" when it is not this year. The critique
// found five shapes on screen and no rule: ISO "2026-09-24" in Customers,
// Vouchers, Find a booking and the draft card, "24.09" in the Activity log,
// "Sep 21 – 27, 2026" in the Week view, "24 Sept 2026" in a booking's history
// and "Thu 24.09.2026" in the date field. The date field is the one staff read
// every shift, so its shape is the one kept, with the year dropped where it
// says nothing: a restaurant's dates are almost all this year's.
//
// The weekday leads because staff think in service days — "Friday's twelve"
// — and it is the part a bare "24.09" makes them work out.
//
// Two options, and only two, because each is a considered exception:
//   · `weekday: false` — where a weekday is already beside it (the Day sheet
//     prints the long one) or would be noise (a voucher's expiry);
//   · `year: "always"` — a record read after the year it describes ends (the
//     printed Day sheet, which gets filed).
// `today` is the test seam, as `now` is for `todayStr`.
//
// Anything that is not a CANONICAL date comes back as it was, never as "".
// `sanitize` guarantees `date` is a string and never that it is well-formed,
// and a booking with a broken date is exactly the one somebody needs to SEE in
// order to repair (the v17.16.6 BlockModal rule) — hiding it would make it
// unfindable. Canonical is `weekdayShort`'s test, for the same reason.
//
// v18.2.0 phase 54 (round 3's C-5): the weekday and the day are joined by a
// NO-BREAK space (U+00A0), as `money()` joins an amount and its symbol (phase
// 45), so a wrapping line never ends on "Thu" and starts the next on "24.09".
// Anything that SEARCHES text holding this must fold it to a plain space (the
// Activity log does); nothing stores it — records keep ISO.
export function formatDay(dateStr, opts) {
  const o = opts || {};
  if (typeof dateStr !== "string" || stepUTC(dateStr, 0) !== dateStr) return dateStr == null ? "" : String(dateStr);
  const withYear = o.year === "always" || showsYear(dateStr, o.today);
  const dm = dateStr.slice(8, 10) + "." + dateStr.slice(5, 7) + (withYear ? "." + dateStr.slice(0, 4) : "");
  return o.weekday === false ? dm : WEEKDAY_SHORT[new Date(dateStr).getUTCDay()] + "\u00a0" + dm;
}

// Does `formatDay` print this day's year? The one place that decides it, and
// exported because a COLUMN of dates has to know too: "Wed 24.09" is 66px in
// Find a booking's bold and "Wed 24.09.2025" 103, so a list sizes its date
// column once, to the widest date it holds, rather than letting one row with a
// year push the rest of its row out of line.
export function showsYear(dateStr, today) {
  return typeof dateStr === "string" && stepUTC(dateStr, 0) === dateStr &&
    dateStr.slice(0, 4) !== String(today || todayStr()).slice(0, 4);
}

// The LOCAL day an instant fell on — a timestamp (ms, or an ISO date-time
// string) in, "YYYY-MM-DD" out, so a stamp can be written by `formatDay`.
// `todayStr` does exactly this for NOW; it is the same function under the name
// its callers mean, and it answers "" for an instant that is not one.
//
// NOT for a date-only string: "2026-09-24" parses as UTC midnight, which is the
// previous local day anywhere west of UTC — `todayStr`'s own warning.
export function localDay(at) {
  const d = new Date(at);
  return at != null && at !== "" && Number.isFinite(d.getTime()) ? todayStr(d) : "";
}

// Every canonical date inside a line of STORED text, written the house way.
// The texts were composed before this rule and are records, so they are never
// re-written — "date 2026-09-24→2026-09-25" in a booking's history, "deleted
// … · 2026-09-24 20:00" in the Activity log. Displaying them through this keeps
// one shape on screen while the data keeps the sortable one.
//
// `\b` on both sides, and `_` counts as a word character: a recurring
// occurrence's id ends in "_2026-09-24" and must never be touched.
export function formatDaysIn(text, opts) {
  return String(text == null ? "" : text).replace(/\b\d{4}-\d{2}-\d{2}\b/g, function (iso) { return formatDay(iso, opts); });
}

// NOW, expressed in minutes since midnight of `dateStr` — the one axis on which
// `nowOn(b.date, today, nowMins)` and `toMins(b.time)` may be compared.
//
// For a booking on today this is `nowMins` unchanged, which is why every
// existing same-day call site keeps its exact behaviour. For yesterday's
// booking at 00:30 it is 1470 (24h + 30m past that day's midnight), so a party
// seated at 23:30 reads as one hour in rather than fifteen minutes. For a
// FUTURE date it goes negative, which is the correct reading — now is that many
// minutes BEFORE that day's midnight — and is what lets `pastCloseMins` answer
// "no" for a date whose close cannot have passed yet.
export function nowOn(dateStr, today, nowMins) {
  return dayDiff(dateStr, today) * 1440 + nowMins;
}
