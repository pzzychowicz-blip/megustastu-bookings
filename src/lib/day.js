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
export function todayStr(now) {
  const d = now || new Date();
  return String(d.getFullYear()) + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
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
