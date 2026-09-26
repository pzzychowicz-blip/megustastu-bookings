// tests/waitlist-match.test.js
//
// v17.8.0 — `placeWaitlist`, the function that decides WHICH TABLE the app
// offers each waiting party. It was the most consequential logic this version
// changed and, until it was extracted from App.jsx's useEffect, no test could
// reach it: the double-booking fix shipped on "it looked right in DEV".
//
// Like tests/booking-logic.test.js, importing the module seeds the real MGT
// layout via constants.js's module-load setLayout(DEFAULT_LAYOUT): 13 tables,
// 28 seats, hours 13:00–22:00, duration tiers ≤4 → 90 min else 120.
// A fixed FUTURE date keeps optimizerActiveFor true and the today-only clock
// paths out of the fixtures.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { placeWaitlist } from "../src/lib/waitlist-match.js";
import { genId, isAllIn, isAllOut } from "../src/lib/booking-logic.js";
import { ALL_TABLES } from "../src/lib/constants.js";

// ALL_TABLES holds {id, capacity} objects, not ids — a booking's `tables` is a
// string array, so a fixture built straight from it silently occupies nothing.
const TABLE_IDS = ALL_TABLES.map((t) => t.id);

const D = "2099-06-15";                 // future → optimizer active
const TODAY = "2099-06-01";             // any date < D, so D is never "past"

function bk(o) {
  return Object.assign({
    id: genId(), name: "B", phone: "", date: D, time: "19:00", size: 2,
    duration: 90, preference: "auto", status: "confirmed", tables: [],
    _locked: false, _manual: false, preferredTables: [], history: [],
  }, o);
}

let seq = 0;
function w(o) {
  seq += 1;
  return Object.assign({
    id: "w" + seq, name: "W" + seq, phone: "", date: D, size: 2,
    status: "waiting", createdAt: 1000 + seq,
  }, o);
}

function run(o) {
  return placeWaitlist(Object.assign({
    bookings: [], waitlist: [], blocks: [], autoOptimizer: true,
    nowMins: 0, todayStr: TODAY, matchWin: 90,
  }, o));
}

// The tables a result set hands out, flattened — the thing that must not repeat.
function allTables(res) {
  return Object.values(res).flatMap((r) => r.tables);
}

describe("placeWaitlist — the sequential guarantee", () => {
  // THE regression test. Before v17.8.0 every entry was matched independently
  // against the same snapshot, so identical inputs produced identical answers.
  it("gives four identical parties four DIFFERENT tables at the same time", () => {
    const wl = [w({ prefTime: "19:00" }), w({ prefTime: "19:00" }), w({ prefTime: "19:00" }), w({ prefTime: "19:00" })];
    const res = run({ waitlist: wl });
    expect(Object.keys(res)).toHaveLength(4);
    Object.values(res).forEach((r) => expect(r.time).toBe("19:00"));
    const t = allTables(res);
    expect(new Set(t).size).toBe(t.length);
  });

  it("never hands out a table twice, however many parties want the same slot", () => {
    const wl = Array.from({ length: 12 }, () => w({ prefTime: "19:00" }));
    const t = allTables(run({ waitlist: wl }));
    expect(new Set(t).size).toBe(t.length);
  });

  it("stops offering once the restaurant is genuinely full at that time", () => {
    // 20 parties, 13 tables: some must go unmatched at the wanted time rather
    // than doubling up. (Those that miss can still match elsewhere in the ±90
    // window, so the assertion is about tables, not about count.)
    const wl = Array.from({ length: 20 }, () => w({ prefTime: "19:00" }));
    const res = run({ waitlist: wl });
    const at1900 = Object.values(res).filter((r) => r.time === "19:00").flatMap((r) => r.tables);
    expect(new Set(at1900).size).toBe(at1900.length);
    expect(at1900.length).toBeLessThanOrEqual(TABLE_IDS.length);
  });

  it("respects real bookings as well as holds", () => {
    const taken = bk({ time: "19:00", tables: ["2"] });
    const res = run({ bookings: [taken], waitlist: [w({ prefTime: "19:00" }), w({ prefTime: "19:00" })] });
    expect(allTables(res)).not.toContain("2");
  });
});

describe("placeWaitlist — FCFS is the tie-break", () => {
  it("orders by createdAt, not by array order", () => {
    const late = w({ id: "late", prefTime: "19:00", createdAt: 9999 });
    const early = w({ id: "early", prefTime: "19:00", createdAt: 1 });
    // Feed them in the WRONG order; the earlier party must still be placed first.
    const res = run({ waitlist: [late, early] });
    const alone = run({ waitlist: [early] });
    expect(res.early.tables).toEqual(alone.early.tables);
  });

  it("is deterministic — the same input twice gives the same assignment", () => {
    const wl = [w({ prefTime: "19:00" }), w({ prefTime: "19:00" }), w({ prefTime: "20:00" })];
    expect(run({ waitlist: wl })).toEqual(run({ waitlist: wl }));
  });

  it("treats a missing createdAt as earliest rather than throwing", () => {
    const wl = [w({ prefTime: "19:00" }), w({ id: "nocreated", prefTime: "19:00", createdAt: undefined })];
    const res = run({ waitlist: wl });
    expect(Object.keys(res)).toHaveLength(2);
    expect(new Set(allTables(res)).size).toBe(allTables(res).length);
  });
});

describe("placeWaitlist — who is considered at all", () => {
  it("skips entries that are not waiting", () => {
    expect(run({ waitlist: [w({ status: "booked", prefTime: "19:00" })] })).toEqual({});
    expect(run({ waitlist: [w({ status: "removed", prefTime: "19:00" })] })).toEqual({});
  });

  it("skips past dates and undated entries", () => {
    expect(run({ waitlist: [w({ date: "2099-05-01" })] })).toEqual({});
    expect(run({ waitlist: [w({ date: "" })] })).toEqual({});
  });

  it("survives a null/garbage entry in the list", () => {
    const res = run({ waitlist: [null, undefined, w({ prefTime: "19:00" })] });
    expect(Object.keys(res)).toHaveLength(1);
  });

  it("defaults a missing size to 2 rather than producing NaN times", () => {
    const res = run({ waitlist: [w({ size: undefined, prefTime: "19:00" })] });
    expect(res.w1 || Object.values(res)[0]).toBeTruthy();
    expect(Object.values(res)[0].time).toBe("19:00");
  });
});

describe("placeWaitlist — the wanted time and its window", () => {
  it("uses prefTime exactly when it fits", () => {
    const res = run({ waitlist: [w({ prefTime: "18:30" })] });
    expect(Object.values(res)[0].time).toBe("18:30");
  });

  it("stays within ±matchWin of the wanted time", () => {
    // Block the whole evening so the only free slots are far from 20:00.
    const full = TABLE_IDS.map((t) => bk({ time: "18:00", duration: 300, tables: [t], _locked: true }));
    const res = run({ bookings: full, waitlist: [w({ prefTime: "20:00" })], matchWin: 30 });
    expect(res).toEqual({});   // nothing inside 19:30–20:30, so no offer at all
  });

  it("a wider window finds a slot the narrow one refuses", () => {
    const busy = TABLE_IDS.map((t) => bk({ time: "18:00", duration: 180, tables: [t], _locked: true }));
    const narrow = run({ bookings: busy, waitlist: [w({ id: "n", prefTime: "19:00" })], matchWin: 15 });
    const wide = run({ bookings: busy, waitlist: [w({ id: "n", prefTime: "19:00" })], matchWin: 180 });
    expect(narrow.n).toBeUndefined();
    expect(wide.n).toBeTruthy();
  });

  it("scans the whole day when there is no wanted time", () => {
    const res = run({ waitlist: [w({ prefTime: undefined })] });
    expect(Object.values(res)[0].time).toBe("13:00");   // opening
  });
});

describe("placeWaitlist — the resh flag", () => {
  it("is false for a plainly free table", () => {
    const res = run({ waitlist: [w({ prefTime: "19:00" })] });
    expect(Object.values(res)[0].resh).toBe(false);
  });

  it("is false when the optimizer is off, because no reshuffle was allowed", () => {
    const todayD = new Date().toISOString().slice(0, 10);
    const res = placeWaitlist({
      bookings: [], waitlist: [w({ date: todayD, prefTime: "19:00" })], blocks: [],
      autoOptimizer: false, nowMins: 0, todayStr: todayD, matchWin: 90,
    });
    Object.values(res).forEach((r) => expect(r.resh).toBe(false));
  });
});

describe("placeWaitlist — the time budget and its anti-flap carry", () => {
  // A clock that jumps past the budget on its second reading, so the very first
  // expensive trial is refused.
  function burnedClock(budget) {
    let n = 0;
    return () => (n++ === 0 ? 0 : budget + 1);
  }

  it("carries a previous answer forward when the budget cut the scan short", () => {
    const prev = { keep: { tables: ["2"], time: "19:00", resh: false } };
    // Fill every table so the cheap path cannot hit and the trial is required.
    const full = TABLE_IDS.map((t) => bk({ time: "13:00", duration: 600, tables: [t], _locked: true }));
    const res = placeWaitlist({
      bookings: full, waitlist: [w({ id: "keep", prefTime: "19:00" })], blocks: [],
      autoOptimizer: true, nowMins: 0, todayStr: TODAY, matchWin: 90,
      prev, budgetMs: 5, now: burnedClock(5),
    });
    expect(res.keep).toEqual(prev.keep);
  });

  it("does NOT carry forward when the entry genuinely stopped fitting", () => {
    const prev = { gone: { tables: ["2"], time: "19:00", resh: false } };
    const full = TABLE_IDS.map((t) => bk({ time: "13:00", duration: 600, tables: [t], _locked: true }));
    const res = placeWaitlist({
      bookings: full, waitlist: [w({ id: "gone", prefTime: "19:00" })], blocks: [],
      autoOptimizer: true, nowMins: 0, todayStr: TODAY, matchWin: 90, prev,
    });
    expect(res.gone).toBeUndefined();
  });

  // The carry-forward is HELD, or the queue behind it can't see it and the
  // double-booking this whole shape prevents comes straight back.
  it("holds a carried-forward answer against the rest of the queue", () => {
    const prev = { first: { tables: ["2"], time: "19:00", resh: false } };
    const full = TABLE_IDS.map((t) => bk({ time: "13:00", duration: 600, tables: [t], _locked: true }));
    const res = placeWaitlist({
      bookings: full,
      waitlist: [w({ id: "first", prefTime: "19:00", createdAt: 1 }),
                 w({ id: "second", prefTime: "19:00", createdAt: 2 })],
      blocks: [], autoOptimizer: true, nowMins: 0, todayStr: TODAY, matchWin: 90,
      prev, budgetMs: 5, now: burnedClock(5),
    });
    expect(res.first).toEqual(prev.first);
    if (res.second) expect(res.second.tables).not.toContain("2");
  });
});

describe("placeWaitlist — purity", () => {
  it("does not mutate its inputs", () => {
    const bookings = [bk({ time: "19:00", tables: ["2"] })];
    const wl = [w({ prefTime: "19:00" }), w({ prefTime: "19:00" })];
    const bSnap = JSON.stringify(bookings);
    const wSnap = JSON.stringify(wl);
    run({ bookings, waitlist: wl });
    expect(JSON.stringify(bookings)).toBe(bSnap);
    expect(JSON.stringify(wl)).toBe(wSnap);
  });

  it("never leaks a synthetic hold into the result", () => {
    const res = run({ waitlist: [w({ prefTime: "19:00" }), w({ prefTime: "19:00" })] });
    Object.keys(res).forEach((k) => expect(k.startsWith("__wait_")).toBe(false));
  });
});

// v18.2.0 phase 68 — the critique's L-1. The waitlist forgot a party's seating
// preference: measured on DEV, "Indoor Probe", 11 guests refused indoor (the
// indoor combination seats 10), was offered outdoor tables 2, 3, 4, 5A and 5B.
// The entry keeps the zone and the match honours it STRICTLY (Patryk): stricter
// than the booking form on a day the optimiser runs, whose trialFits falls back
// to any zone when the preferred one is full.
describe("placeWaitlist — a party's seating preference (v18.2.0 phase 68)", () => {
  it("offers an indoor party of 11 NOTHING when indoor seats 10 — L-1's case", () => {
    const res = run({ waitlist: [w({ size: 11, prefTime: "20:00", preference: "indoor" })] });
    expect(Object.keys(res)).toHaveLength(0);
    // …where the same party with no preference is placed, and not indoors only
    // (on the default layout, the mixed combination 1A + 1B + 7 + i4).
    const auto = run({ waitlist: [w({ size: 11, prefTime: "20:00" })] });
    const r = Object.values(auto)[0];
    expect(r && r.tables.length).toBeGreaterThan(0);
    expect(isAllIn(r.tables)).toBe(false);
  });

  it("offers an indoor party indoor tables, and an outdoor party outdoor ones", () => {
    const res = run({ waitlist: [
      w({ size: 4, prefTime: "20:00", preference: "indoor" }),
      w({ size: 4, prefTime: "20:00", preference: "outdoor" }),
    ] });
    const [a, b] = Object.values(res);
    expect(isAllIn(a.tables)).toBe(true);
    expect(isAllOut(b.tables)).toBe(true);
  });

  it("with its zone full, an indoor party waits even though outdoor is free", () => {
    const indoor = ALL_TABLES.filter((t) => t.zone === "indoor" || /^i/.test(t.id)).map((t) => t.id);
    const full = indoor.map((id) => bk({ time: "19:30", duration: 180, tables: [id], _locked: true }));
    const res = run({ bookings: full, waitlist: [w({ size: 2, prefTime: "20:00", preference: "indoor" })] });
    expect(Object.keys(res)).toHaveLength(0);
    const auto = run({ bookings: full, waitlist: [w({ size: 2, prefTime: "20:00" })] });
    expect(isAllOut(Object.values(auto)[0].tables)).toBe(true);
  });

  it("an unknown or 'auto' preference changes nothing", () => {
    const a = run({ waitlist: [w({ size: 2, prefTime: "20:00", preference: "auto" })] });
    const b = run({ waitlist: [w({ size: 2, prefTime: "20:00", preference: "patio" })] });
    const c = run({ waitlist: [w({ size: 2, prefTime: "20:00" })] });
    expect(Object.values(a)[0].tables).toEqual(Object.values(c)[0].tables);
    expect(Object.values(b)[0].tables).toEqual(Object.values(c)[0].tables);
  });
});

// The entry has to CARRY the zone for the match to honour it: stored only when
// one was stated (Firebase throws on an undefined property; absent reads as
// "auto"), passed by the booking form's Add to waitlist, handed back by Book,
// and said on the waitlist row and the printed Day sheet.
describe("phase 68 — the entry carries the zone, and the row says it", () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
  it("stores a stated zone and omits anything else", () => {
    expect(read("hooks/useWaitlist.js")).toMatch(/if\(preference==="indoor"\|\|preference==="outdoor"\) entry\.preference=preference;/);
  });
  it("the booking form passes it, and Book brings it back", () => {
    const App = read("App.jsx");
    expect(App).toMatch(/notes:f\.notes\|\|"",\s*preference:f\.preference\s*\}\);/);
    expect(App).toMatch(/preference:w\.preference==="indoor"\|\|w\.preference==="outdoor"\?w\.preference:"auto"/);
  });
  it("the waitlist row and the Day sheet say it", () => {
    expect(read("components/WaitlistPanel.jsx")).toMatch(/\{w\.preference==="indoor"\|\|w\.preference==="outdoor"\?<span style=\{ZONE_FLAG\}>/);
    expect(read("components/DaySheet.jsx")).toMatch(/\(w\.preference === "indoor" \? " · indoor" : w\.preference === "outdoor" \? " · outdoor" : ""\)/);
  });
});
