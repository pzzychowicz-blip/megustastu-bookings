// tests/day.test.js
//
// Safety-net for src/lib/day.js — the two questions the app had never answered
// once: what day is it, and how do "now" and a booking share an axis.
//
// These are worth pinning rather than reading, because both defects they cover
// were invisible in review for the same reason: the wrong answer is a plausible
// number. `todayStr` returning yesterday reads as a date; `nowOn` missing its
// day term returns minutes. Nothing about either looks like a failure until you
// know what the right answer was.
//
// The timezone cases set `process.env.TZ`, which Node honours at runtime. That
// is what makes the Canary scenario DETERMINISTIC instead of a test that passes
// or fails depending on the machine it runs on — the whole class of defect here
// only exists in certain zones and certain months, so a TZ-agnostic test would
// be testing nothing.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import process from "node:process";
import { todayStr, dayDiff, nowOn, addDays } from "../src/lib/day.js";
import { EMPTY_FORM } from "../src/lib/constants.js";

const REAL_TZ = process.env.TZ;
function withTZ(tz, fn) {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally { process.env.TZ = prev; }
}
beforeAll(() => { process.env.TZ = "UTC"; });
afterAll(() => { process.env.TZ = REAL_TZ; });

describe("todayStr — formatting", () => {
  it("zero-pads month and day to two digits", () => {
    // Month is 0-indexed in the Date constructor: 0 = January.
    expect(todayStr(new Date(2026, 0, 5, 12, 0))).toBe("2026-01-05");
    expect(todayStr(new Date(2026, 11, 25, 12, 0))).toBe("2026-12-25");
  });
  it("reads the LOCAL calendar fields, so a midday instant is unambiguous", () => {
    expect(todayStr(new Date(2026, 7, 31, 12, 0))).toBe("2026-08-31");
  });
});

// The defect itself (CT-2B-03). Me Gustas Tú is in the Canaries: WEST (UTC+1)
// from late March to late October, WET (UTC+0) the rest of the year. So the app
// disagreed with the wall clock for the first hour of every local day, for eight
// months a year, and agreed perfectly for the other four — which is exactly the
// shape of a bug that survives years of use without being reported.
describe("todayStr — the UTC/local divergence this function exists to remove", () => {
  it("summer (UTC+1): 00:30 local is the NEW day, where toISOString still says the old one", () => {
    withTZ("Atlantic/Canary", () => {
      const instant = new Date(Date.UTC(2026, 7, 30, 23, 30)); // local 2026-08-31 00:30
      expect(todayStr(instant)).toBe("2026-08-31");
      // The expression this replaced, on the same instant — one day behind.
      expect(instant.toISOString().slice(0, 10)).toBe("2026-08-30");
    });
  });
  it("winter (UTC+0): the two agree, which is why the bug is seasonal", () => {
    withTZ("Atlantic/Canary", () => {
      const instant = new Date(Date.UTC(2026, 0, 15, 0, 30)); // local 2026-01-15 00:30
      expect(todayStr(instant)).toBe("2026-01-15");
      expect(instant.toISOString().slice(0, 10)).toBe("2026-01-15");
    });
  });
  it("west of UTC it fails the other way, which is why a date STRING must never be passed in", () => {
    withTZ("America/New_York", () => {
      const instant = new Date(Date.UTC(2026, 7, 31, 2, 0)); // local 2026-08-30 22:00
      expect(todayStr(instant)).toBe("2026-08-30");
      expect(instant.toISOString().slice(0, 10)).toBe("2026-08-31");
    });
  });
});

describe("dayDiff", () => {
  it("is zero for one day against itself", () => {
    expect(dayDiff("2026-08-31", "2026-08-31")).toBe(0);
  });
  it("counts forward and backward", () => {
    expect(dayDiff("2026-08-30", "2026-08-31")).toBe(1);
    expect(dayDiff("2026-08-31", "2026-08-30")).toBe(-1);
  });
  it("crosses a month and a year boundary", () => {
    expect(dayDiff("2026-08-31", "2026-09-01")).toBe(1);
    expect(dayDiff("2026-12-31", "2027-01-01")).toBe(1);
    expect(dayDiff("2026-02-28", "2026-03-01")).toBe(1); // 2026 is not a leap year
    expect(dayDiff("2024-02-28", "2024-03-01")).toBe(2); // 2024 is
  });

  // The reason both arguments stay UTC. EU clocks go forward on 2026-03-29 and
  // back on 2026-10-25, so these spans are 47 and 49 LOCAL hours. Parsing the
  // endpoints as UTC midnight makes both an exact 2 days; local midnights would
  // give 1.958 and 2.042, and Math.round would only hide it until a span that
  // rounded the wrong way.
  it("is unaffected by a DST transition, in both directions", () => {
    withTZ("Atlantic/Canary", () => {
      expect(dayDiff("2026-03-28", "2026-03-30")).toBe(2); // spring forward
      expect(dayDiff("2026-10-24", "2026-10-26")).toBe(2); // fall back
    });
  });
  it("is NaN for an unparseable date rather than a plausible zero", () => {
    // sanitize guarantees `date` is a string, never that it is well-formed
    // (CT-2A-03), so this input is reachable. A caller writing a derived number
    // to the database checks it THERE, where refusing means something.
    expect(dayDiff("31/08/2026", "2026-08-31")).toBeNaN();
    expect(dayDiff("2026-08-31", "")).toBeNaN();
  });
});

describe("nowOn", () => {
  // This is what guarantees the 14 same-day call sites keep their exact
  // behaviour: on today's booking the projection is the identity.
  it("returns nowMins unchanged for a booking on today", () => {
    expect(nowOn("2026-08-31", "2026-08-31", 0)).toBe(0);
    expect(nowOn("2026-08-31", "2026-08-31", 1290)).toBe(1290);
  });
  it("adds a full day per day elapsed", () => {
    expect(nowOn("2026-08-30", "2026-08-31", 30)).toBe(1470);
    expect(nowOn("2026-08-29", "2026-08-31", 30)).toBe(2910);
  });
  it("goes negative for a future date — now is that many minutes before its midnight", () => {
    expect(nowOn("2026-09-01", "2026-08-31", 30)).toBe(-1410);
  });

  // CT-2B-01, reconstructed as arithmetic. A 23:30 booking of 60 minutes ends
  // at 1470 on its own axis. Seating it at 00:30 the next day used to compare
  // that against a bare nowMins of 30 — so `now >= scheduledEnd` was false, and
  // applySeatedShift wrote `duration: scheduledEnd - now` = 1440. On the shared
  // axis now IS 1470, the guard fires, and no shift is written at all.
  it("puts the 23:30-seated-at-00:30 case on one axis", () => {
    const scheduledEnd = 23 * 60 + 30 + 60;
    const naive = 30;
    const projected = nowOn("2026-08-30", "2026-08-31", 30);
    expect(scheduledEnd - naive).toBe(1440);      // the bug: a 24-hour booking
    expect(projected).toBe(scheduledEnd);          // the fix: the party is due out now
    expect(projected >= scheduledEnd).toBe(true);
  });
});

// The date-navigation bug this version also closes. Not in the crash-test
// register — found while widening the CT-2B-03 sweep's regex, because the four
// broken sites spell the same mistake a different way.
describe("addDays — the arrows, and the day they did nothing", () => {
  it("steps forward and back", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-09-01", -1)).toBe("2026-08-31");
    expect(addDays("2026-08-31", 7)).toBe("2026-09-07");
    expect(addDays("2026-08-31", 0)).toBe("2026-08-31");
  });
  it("crosses a year and a leap day", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  // The defect. `new Date(dateStr)` is UTC midnight while setDate/getDate are
  // LOCAL, so on the 23-hour spring-forward day +1 local day landed before the
  // next UTC midnight and the readback returned the SAME date: the Next-day
  // button and the → key did nothing at all on 29 March.
  it("crosses the spring-forward day, where the old expression stood still", () => {
    withTZ("Atlantic/Canary", () => {
      expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
      // The hand-rolled version this replaced, on the same input:
      const naive = (ds, n) => { const d = new Date(ds); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
      expect(naive("2026-03-29", 1)).toBe("2026-03-29");   // stuck
      expect(addDays("2026-03-29", 1)).not.toBe(naive("2026-03-29", 1));
    });
  });
  it("crosses the autumn fall-back day too", () => {
    withTZ("Atlantic/Canary", () => {
      expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
      expect(addDays("2026-10-26", -1)).toBe("2026-10-25");
    });
  });
  it("never stands still, on any day of a DST year, in either direction", () => {
    // The property the four call sites actually need: a step always moves.
    withTZ("Atlantic/Canary", () => {
      let d = "2026-01-01";
      for (let i = 0; i < 365; i++) {
        const next = addDays(d, 1);
        expect(next).not.toBe(d);
        expect(addDays(next, -1)).toBe(d);
        d = next;
      }
      expect(d).toBe("2027-01-01");
    });
  });
});

// v17.16.5. `EMPTY_FORM` is built once at module load, so its `date` was
// yesterday's for the whole of the next service on a tablet left open across
// midnight. It lives here rather than in a constants suite because what is
// actually being pinned is that the default tracks `todayStr()` — and because
// the getter's whole justification is that no CONSUMER has to change, which is
// what these assertions check.
describe("EMPTY_FORM.date tracks today", () => {
  // The clock has to MOVE, or this test cannot fail: within one process on one
  // day, a value frozen at import and a value recomputed on read are identical,
  // so asserting `EMPTY_FORM.date === todayStr()` would pass on the very build
  // this fixes. Crossing midnight under fake timers is the observation that
  // separates them — it is the whole defect, reproduced.
  it("follows the clock across midnight", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 8, 2, 23, 59));
      expect(EMPTY_FORM.date).toBe("2026-09-02");
      vi.setSystemTime(new Date(2026, 8, 3, 0, 1));
      expect(EMPTY_FORM.date).toBe("2026-09-03");
    } finally {
      vi.useRealTimers();
    }
  });
  it("copies as a plain string through every shape a call site uses", () => {
    // Object.assign is the form all three openForm call sites take; spread is
    // what the form-state initializers take. Both READ an accessor and copy the
    // result, which is why the getter needed no call-site change.
    expect(Object.assign({}, EMPTY_FORM).date).toBe(todayStr());
    expect({ ...EMPTY_FORM }.date).toBe(todayStr());
    expect(typeof Object.assign({}, EMPTY_FORM).date).toBe("string");
    // An explicit date still wins — openNew/bookAgain/bookFromWaitlist all pass
    // one, and the getter must not shadow it.
    expect(Object.assign({}, EMPTY_FORM, { date: "2026-01-01" }).date).toBe("2026-01-01");
    // Not an own-property trap: it survives serialisation like any value.
    expect(JSON.parse(JSON.stringify(EMPTY_FORM)).date).toBe(todayStr());
  });
});
