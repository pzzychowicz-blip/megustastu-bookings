// tests/plan-avail.test.js — v18.2.0 phase 21: table availability on the Plan
// view (src/lib/plan-avail.js), and the wiring that keeps the rim and the
// "Walk-in here" offer reading one answer.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nextBusyAt, freeWindow } from "../src/lib/plan-avail.js";
import { firstStartOf } from "../src/lib/booking-logic.js";
import { PREF_SPEC, DEFAULT_USER_PREFS, sanitizeUserPrefs, readPrefValue } from "../src/hooks/useUserPrefs.js";
import { stripComments } from "../scripts/strip-comments.mjs";

const read = (...p) => stripComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ...p), "utf8")).join("\n");
const m = (hhmm) => { const [h, mm] = hhmm.split(":").map(Number); return h * 60 + mm; };
const bk = (id, time, tables, status = "confirmed") => ({ id, time, tables, status, date: "2026-10-01" });
const CLOSE = m("23:00");

describe("nextBusyAt — the first minute after `at` that claims the table", () => {
  const day = [
    bk("a", "19:30", ["1A"]),
    bk("b", "21:00", ["1A"], "pending"),
    bk("c", "18:00", ["1A"]),                 // before `at`: not "next"
    bk("d", "19:00", ["2"]),                  // another table
    bk("e", "19:15", ["1A"], "completed"),    // a completed visit frees its table
    bk("f", "19:10", ["1A"], "cancelled"),
  ];

  it("takes the earliest later start on that table, any status that still holds it", () => {
    expect(nextBusyAt("1A", m("18:30"), day, [], CLOSE)).toBe(m("19:30"));
    expect(nextBusyAt("1A", m("19:45"), day, [], CLOSE)).toBe(m("21:00"));
    // A later SEATED booking counts: scrubbed back before a party sat down.
    expect(nextBusyAt("5A", m("17:00"), [bk("s", "19:00", ["5A"], "seated")], [], CLOSE)).toBe(m("19:00"));
  });

  it("answers the day's end when nothing needs the table again", () => {
    expect(nextBusyAt("1A", m("21:30"), day, [], CLOSE)).toBe(CLOSE);
    expect(nextBusyAt("7", m("13:00"), day, [], CLOSE)).toBe(CLOSE);
  });

  it("a table block starting later counts like a booking", () => {
    const blocks = [{ tables: ["1A"], s: m("19:00"), e: m("20:00") }, { tables: ["2"], s: m("18:45"), e: m("19:00") }];
    expect(nextBusyAt("1A", m("18:30"), day, blocks, CLOSE)).toBe(m("19:00"));
  });
});

describe("freeWindow — what the plan draws for a free table", () => {
  const day = [bk("a", "19:30", ["1A"])];

  it("`until` is the next claim, or null when free to closing (no label then)", () => {
    expect(freeWindow("1A", m("18:00"), day, [], CLOSE, 90).until).toBe(m("19:30"));
    expect(freeWindow("2", m("18:00"), day, [], CLOSE, 90).until).toBeNull();
  });

  it("`fits` is a whole visit before that claim — exactly enough fits", () => {
    expect(freeWindow("1A", m("18:00"), day, [], CLOSE, 90).fits).toBe(true);    // 90 of 90
    expect(freeWindow("1A", m("18:01"), day, [], CLOSE, 90).fits).toBe(false);   // 89 of 90
    expect(freeWindow("1A", m("18:00"), day, [], CLOSE, 90 + 15).fits).toBe(false); // + turnaround
  });

  it("a table free to closing still has to fit before the day ends", () => {
    expect(freeWindow("2", m("22:00"), day, [], CLOSE, 90)).toEqual({ until: null, fits: false });
  });
});

describe("the per-person switch (Settings → App)", () => {
  it("is ON by default: only an explicit off is stored", () => {
    expect(PREF_SPEC.planAvail).toEqual({ ls: "mgt-plan-avail", store: "whenOff" });
    expect(readPrefValue("whenOff", null)).toBe(true);
    expect(DEFAULT_USER_PREFS.planAvail).toBeNull();
    expect(sanitizeUserPrefs({}).planAvail).toBeNull();
    expect(sanitizeUserPrefs({ planAvail: false }).planAvail).toBe(false);
  });
});

describe("the wiring", () => {
  const Plan = read("src", "components", "PlanView.jsx");
  const App = read("src", "App.jsx");
  const Settings = read("src", "components", "Settings.jsx");

  it("the rim and the Walk-in offer read ONE answer, for the default walk-in size", () => {
    expect(Plan).toMatch(/const needMins = getDur\(walkinSize\) \+ turnBuffer;/);
    expect(Plan).toMatch(/const windowOf = \(id\) => freeWindow\(id, slider, day, blockSlots, closeM, needMins\);/);
    expect(Plan).toMatch(/const canWalkin = freeNow && isToday && windowOf\(id\)\.fits;/);
    expect(Plan).toMatch(/const avail = showAvail && freeAt\(t\.id\) \? windowOf\(t\.id\) : null;/);
    expect(Plan, "the old hard-coded party of 2 is gone").not.toMatch(/getDur\(2\)/);
  });

  it("App passes the switch and the walk-in size as scalars (PlanView is memo'd)", () => {
    expect(App).toMatch(/showAvail=\{planAvail\}\s*walkinSize=\{generalSettings\.defaultWalkinSize\}/);
    expect(App).toMatch(/const \[planAvail,setPlanAvail\]=useState\(function\(\)\{return readPrefLS\("planAvail"\);\}\);/);
    expect(App).toMatch(/planAvail:\{value:planAvail,set:setPlanAvail\}/);
  });

  it("the App tab has the switch, named as it reads", () => {
    expect(Settings).toMatch(/<Toggle label="Table availability" on=\{planAvail\} onClick=\{onTogglePlanAvail\} \/>/);
  });
});

// v18.2.0 phase 67 (the ROADMAP follow-up): the Plan's scrubber opened a day
// that is not today at OPEN, so an evening-only future day showed an empty room.
// It opens on the day's first booking, from the SAME rule the Timeline scrolls
// to. Measured on DEV: today "Now 20:17", Sun 27.09 (first 19:00) "19:00",
// Mon 28.09 (first 18:00) "18:00", back on today the clock again.
describe("phase 67 — a day opens where its bookings start", () => {
  const D = "2026-10-03";
  const b = (time, status = "confirmed", date = D) => ({ date, time, status });

  it("firstStartOf is the day's earliest start, cancelled aside and completed counted", () => {
    expect(firstStartOf([b("20:30"), b("19:00"), b("21:00")], D)).toBe(19 * 60);
    expect(firstStartOf([b("18:00", "cancelled"), b("19:30")], D)).toBe(19 * 60 + 30);
    expect(firstStartOf([b("13:00", "completed"), b("19:30")], D)).toBe(13 * 60);
    expect(firstStartOf([b("12:00", "confirmed", "2026-10-04"), b("19:30")], D)).toBe(19 * 60 + 30);
    expect(firstStartOf([], D)).toBe(Infinity);
    expect(firstStartOf(undefined, D)).toBe(Infinity);
  });

  it("the Plan opens a non-today day on it, and the Timeline scrolls to it, from ONE rule", () => {
    const Plan = read("src", "components", "PlanView.jsx");
    const Timeline = read("src", "components", "TimelineView.jsx");
    expect(Plan).toMatch(/const firstStart = firstStartOf\(bookings, date\);/);
    expect(Plan).toMatch(/const dayStart = \(\) => clampExact\(isToday \? nowMins : \(Number\.isFinite\(firstStart\) \? firstStart : openM\)\);/);
    expect(Plan).toMatch(/useState\(dayStart\)/);
    expect(Plan).toMatch(/useEffect\(\(\) => \{ if \(!isToday && !sliderTouched\) \{ setSlider\(dayStart\(\)\); reCentre\(\); \} \}, \[firstStart\]\);/);
    expect(Timeline).toMatch(/const firstStart = firstStartOf\(bookings, date\);/);
  });
});
