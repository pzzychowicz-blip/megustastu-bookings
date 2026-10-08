// tests/recurring.test.js
//
// v18.3.3 — standing (weekly) bookings.
//
// B2: "Repeat weekly" wrote its rule BEFORE the new-booking save's capacity
// refusals, so a refused save left the rule behind, the generator then created
// the booking the form had just refused, and every further tap on Save added
// another rule. Measured on DEV before the fix: one refused save plus Confirm on
// the "Kitchen may be busy" its generated booking raised = two rules. There is
// no DOM test environment here (tests/CLAUDE.md), so the save's ORDER is pinned
// by reading `doSaveNew` with its comments stripped. v18.3.4: the save's
// decisions are `buildBooking` (src/lib/booking-save.js), run below; what is
// still read is the order App carries them out in.
//
// B3: a rule had no start, so the generator booked every matching weekday from
// TODAY. Measured on DEV before the fix: "Repeat weekly" on Thu 22 Oct also
// booked 1, 8 and 15 Oct. `dueOccurrences` is the generator's decision, pure.
// The dates below are arguments, never compared with a live clock, so they are
// arithmetic fixtures and safe as literals (tests/CLAUDE.md's date row).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";
import { dueOccurrences, ruleStart, withOccurrences } from "../src/lib/recurring.js";
import { todayStr } from "../src/lib/day.js";
import { setWeekHours, DEFAULT_WEEK_HOURS, EMPTY_FORM, ALL_TABLES } from "../src/lib/constants.js";
import { buildBooking } from "../src/lib/booking-save.js";

const APP = stripComments(
  readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8")).join("\n");

// The body of `doSaveNew`, from its declaration to the next top-level function.
function doSaveNewBody() {
  const start = APP.indexOf("function doSaveNew(");
  const end = APP.indexOf("function doSave(", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return APP.slice(start, end);
}

describe("Repeat weekly writes its rule only once the save cannot be refused (B2)", () => {
  it("calls addRule exactly once in doSaveNew", () => {
    expect(doSaveNewBody().split("addRule(").length - 1).toBe(1);
  });

  // v18.4.6: and only once the booking has LANDED. The one `addRule` is the
  // booking write's `onLanded`, so it cannot run for a refused save (nothing
  // is dispatched) or for a booking that never reaches the server.
  it("calls it from the booking write's onLanded, after every refusal", () => {
    const body = doSaveNewBody();
    const lastRefusal = body.lastIndexOf("setError(");
    const write = body.indexOf("saveBookings(plan.next,false,");
    expect(lastRefusal).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(lastRefusal);
    // v18.4.8: the report carries more than the rule (the waitlist party),
    // so the rule is one line of `onLanded`, and still the only `addRule`.
    expect(body.slice(write)).toMatch(/onLanded:function\(\)\{\s*if\(plan\.rule\) addRule\(plan\.rule\);/);
    expect((body.match(/addRule\(/g) || []).length).toBe(1);
  });

  // v18.3.4: the rule and the booking are `buildBooking`'s, so these run it.
  const D = "2099-06-17";   // a Wednesday the optimiser owns
  const save = (list, o) => buildBooking({
    list, draft: Object.assign({}, EMPTY_FORM, { name: "Weekly", date: D, time: "20:00", repeatWeekly: true }, o),
    blocks: [], swap: null, autoOptimizer: true, phonePrefix: "+34", getUser: () => "t",
  });

  it("stamps the first occurrence with the id the rule is written under", () => {
    const plan = save([]);
    const first = plan.fin.find((b) => b.id === plan.id);
    expect(plan.rule.id).toBeTruthy();
    expect(first.recurringId).toBe(plan.rule.id);
    expect(first.recurringDate).toBe(D);
  });

  it("a refused save has no rule to write", () => {
    // Every table held at 20:00 by a party nobody can move.
    const full = ALL_TABLES.map((t, i) => ({
      id: "f" + i, name: "F" + i, date: D, time: "20:00", size: 2, duration: 90, status: "confirmed",
      tables: [t.id], _locked: true, _manual: true, preferredTables: [], history: [],
    }));
    expect(save(full)).toEqual({ refusal: { message: "Could not assign a table — try manual assignment." } });
    expect(save([], { repeatWeekly: false }).rule).toBe(null);
  });
});

// ── B3: where a rule starts ─────────────────────────────────────────────────

const TODAY = "2026-10-01";          // a Thursday (getUTCDay 4)
const rule = (over) => Object.assign(
  { id: "R1", name: "Ana", phone: "", size: 2, weekday: 4, time: "20:00",
    preference: "auto", notes: "", active: true, skipDates: [], createdAt: 1 }, over);
// The booking "Repeat weekly" was ticked on: a genId id, stamped with the rule.
const formBooking = (date) => ({ id: "m" + date, recurringId: "R1", recurringDate: date, date });
// One the generator made: the deterministic id.
const genBooking = (date) => ({ id: "rR1_" + date, recurringId: "R1", recurringDate: date, date });
const dates = (due) => due.map((o) => o.date);

describe("ruleStart", () => {
  it("is the rule's own startDate when it has one", () => {
    expect(ruleStart(rule({ startDate: "2026-10-22" }), [])).toBe("2026-10-22");
  });
  it("is the earliest booking the FORM stamped, for an older rule", () => {
    expect(ruleStart(rule(), [genBooking("2026-10-08"), formBooking("2026-10-22"), formBooking("2026-10-29")]))
      .toBe("2026-10-22");
  });
  it("ignores the generator's own bookings", () => {
    expect(ruleStart(rule(), [genBooking("2026-10-01"), genBooking("2026-10-08")])).toBe(null);
  });
  it("ignores another rule's bookings and a malformed startDate", () => {
    const other = { id: "x", recurringId: "R2", recurringDate: "2026-09-01" };
    expect(ruleStart(rule({ startDate: "22.10.2026" }), [other])).toBe(null);
  });
});

describe("dueOccurrences", () => {
  it("never books the rule's own start date, even before its booking arrives", () => {
    // The race measured on DEV: the rule reached a device ahead of its booking.
    expect(dates(dueOccurrences([rule({ startDate: "2026-10-08" })], [], TODAY, 14)))
      .toEqual(["2026-10-15"]);
  });
  it("does not book the weeks before a rule starts (the DEV measurement)", () => {
    const due = dueOccurrences([rule({ startDate: "2026-10-22" })], [formBooking("2026-10-22")], TODAY, 28);
    expect(dates(due)).toEqual(["2026-10-29"]);
  });
  it("derives the start for an older rule from its form booking", () => {
    const due = dueOccurrences([rule()], [formBooking("2026-10-15")], TODAY, 28);
    expect(dates(due)).toEqual(["2026-10-22", "2026-10-29"]);
  });
  it("keeps the old behaviour for a rule with no start to find", () => {
    expect(dates(dueOccurrences([rule()], [], TODAY, 14)))
      .toEqual(["2026-10-01", "2026-10-08", "2026-10-15"]);
  });
  it("skips existing, skipped and paused occurrences", () => {
    const r = rule({ startDate: TODAY, skipDates: ["2026-10-08"] });
    expect(dates(dueOccurrences([r], [formBooking(TODAY)], TODAY, 14))).toEqual(["2026-10-15"]);
    expect(dueOccurrences([rule({ active: false })], [], TODAY, 14)).toEqual([]);
  });
  it("skips a closed day, and a time past the day's last start", () => {
    try {
      setWeekHours(Object.assign({}, DEFAULT_WEEK_HOURS, { 4: { open: 13, close: 22, closed: true } }));
      expect(dueOccurrences([rule()], [], TODAY, 14)).toEqual([]);
      // 22:00 close: the last start is 21:45, which the form, the Time field
      // and findTimes all name. The loop tested the close itself.
      setWeekHours(DEFAULT_WEEK_HOURS);
      expect(dates(dueOccurrences([rule({ time: "21:45" })], [], TODAY, 0))).toEqual([TODAY]);
      expect(dueOccurrences([rule({ time: "21:50" })], [], TODAY, 0)).toEqual([]);
    } finally { setWeekHours(DEFAULT_WEEK_HOURS); }
  });
});

// v18.4.4 (ROADMAP #17): what the generator's write does to the list. It was
// the body of a `saveBookings` updater inside a useEffect, reachable only by
// `tests/save-path.test.js`, which lifts the effect out of App's source and
// runs it. Those cases still run, through the effect; these call it directly.
describe("withOccurrences", () => {
  const FUTURE = "2099-06-17";               // a day the optimiser owns
  const due = (date, over) => ({ rule: rule(over), date });
  const party = (id, over) => Object.assign({
    id, name: id, phone: "", date: FUTURE, time: "20:00", scheduledTime: "20:00", size: 2, duration: 90,
    originalDuration: 90, status: "confirmed", tables: [], preference: "auto", preferredTables: [], history: [],
  }, over);

  it("adds each due occurrence under its deterministic id, stamped and placed", () => {
    const next = withOccurrences([], [due(FUTURE)], [], true);
    expect(next.length).toBe(1);
    expect(next[0].id).toBe("rR1_" + FUTURE);
    expect(next[0].recurringId).toBe("R1");
    expect(next[0].recurringDate).toBe(FUTURE);
    expect(next[0].tables.length).toBeGreaterThan(0);
  });

  it("with nothing due it hands back the list it was given", () => {
    const prev = [party("a", { tables: ["3"] })];
    expect(withOccurrences(prev, [], [], true)).toBe(prev);
  });

  it("a replayed write does not add an occurrence twice: by its id, or by its stamps once it has moved", () => {
    const first = withOccurrences([], [due(FUTURE)], [], true);
    expect(withOccurrences(first, [due(FUTURE)], [], true).length).toBe(1);
    // Moved to another day by hand: a different date, the same stamps.
    const moved = [Object.assign({}, first[0], { id: "moved1", date: "2099-06-18" })];
    const again = withOccurrences(moved, [due(FUTURE)], [], true);
    expect(again.map((b) => b.id)).toEqual(["moved1"]);
  });

  it("two rules due on one date are both added, on different tables", () => {
    const next = withOccurrences([], [due(FUTURE), due(FUTURE, { id: "R2", name: "Bo" })], [], true);
    expect(next.map((b) => b.id).sort()).toEqual(["rR1_" + FUTURE, "rR2_" + FUTURE]);
    expect(next[0].tables.some((t) => next[1].tables.includes(t))).toBe(false);
  });

  // v18.3.5: today with the optimiser OFF is the one day it does not own.
  describe("today, after the cutoff", () => {
    const TODAY = todayStr();
    it("places the new occurrence by itself and moves nobody else", () => {
      const other = party("other", { date: TODAY, tables: ["7"] });
      const next = withOccurrences([other], [due(TODAY)], [], false);
      const made = next.find((b) => b.id === "rR1_" + TODAY);
      expect(made.tables.length).toBeGreaterThan(0);
      expect(made.tables).not.toContain("7");
      expect(next.find((b) => b.id === "other").tables).toEqual(["7"]);
    });
    it("with no table free it is flagged, not left silently unplaced", () => {
      const wall = ALL_TABLES.map((t) => ({ id: "bl" + t.id, date: TODAY, tableId: t.id, allDay: true }));
      const made = withOccurrences([], [due(TODAY)], wall, false)[0];
      expect(made.tables).toEqual([]);
      expect(made._conflict).toBe(true);
    });
  });
});

describe("the wiring", () => {
  it("App's generator hands the write to withOccurrences and builds no occurrence itself", () => {
    expect(APP).toContain("saveBookings(function(prev){return withOccurrences(prev,toCreate,tableBlocks,autoOptimizer);},true);");
    expect(APP).not.toContain("occurrenceBooking");
  });
  it("App's generator asks dueOccurrences, and a new rule carries startDate", () => {
    expect(APP).toMatch(/const toCreate=dueOccurrences\(recurring\.rules,bookings,todayStr\(\),recurring\.horizonWeeks\*7\)/);
    // v18.3.4: the rule is `buildBooking`'s, and App writes what it is handed.
    const plan = buildBooking({
      list: [], draft: Object.assign({}, EMPTY_FORM, { name: "Weekly", date: "2099-06-17", time: "20:00", repeatWeekly: true }),
      blocks: [], swap: null, autoOptimizer: true, phonePrefix: "+34", getUser: () => "t",
    });
    expect(plan.rule.startDate).toBe("2099-06-17");
    expect(plan.rule.weekday, "a Wednesday").toBe(3);
    expect(doSaveNewBody()).toMatch(/onLanded:function\(\)\{\s*if\(plan\.rule\) addRule\(plan\.rule\);/);
  });
  it("useRecurring's whitelist keeps startDate", () => {
    const HOOK = stripComments(
      readFileSync(new URL("../src/hooks/useRecurring.js", import.meta.url), "utf8")).join("\n");
    expect(HOOK).toMatch(/startDate: r\.startDate/);
  });
});

// v18.3.5: the form's "Repeat weekly" toggle was shown to an account without
// `recurringManage`. With roles enforced the booking saved stamped with the
// rule's id while `database.rules.json` refused the rule, and the banner blamed
// out-of-date data. The toggle is hidden instead (Patryk), at the one prop the
// form reads.
describe("the form's Repeat weekly toggle", () => {
  it("is offered only where standing bookings are on AND the account may manage them", () => {
    const props = APP.match(/standingEnabled=\{([^}]*)\}/g);
    expect(props).toEqual(["standingEnabled={standingOn()}"]);
    expect(APP).toContain('function standingOn(){return recurring.enabled!==false&&can("recurringManage");}');
  });
  // /code-review: hiding the toggle did not stop a rule for a draft that already
  // had it on (the capability removed while the form was open). The save asks
  // the same question, and hands `buildBooking` a draft without it.
  it("is asked again by the save, which drops repeatWeekly where the toggle would not show", () => {
    expect(APP).toContain("const f=f0.repeatWeekly&&!standingOn()?Object.assign({},f0,{repeatWeekly:false}):f0;");
    expect(APP).toMatch(/function doSaveNew\(f0\)\{\s*const f=f0\.repeatWeekly[^\n]*\n\s*const plan=buildBooking\(\{list:bookings,draft:f,/);
  });
  it("is the only way the form sets repeatWeekly, behind that prop", () => {
    const FORM = stripComments(
      readFileSync(new URL("../src/components/BookingFormModal.jsx", import.meta.url), "utf8")).join("\n");
    expect(FORM.match(/repeatWeekly:/g)).toEqual(["repeatWeekly:"]);
    expect(FORM).toMatch(/!editId&&standingEnabled\?/);
  });
});
