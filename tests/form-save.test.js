// v18.6.0 (#17) — what the booking form's Save decides before it reaches the
// day: `draftForSave`, `draftRefusal`, `formSeatClash` and `kitchenAsk`
// (src/lib/booking-save.js). `doSave` and `save` in App.jsx held them inline;
// before the swap the functions were compared with that inline code over
// 60,000 generated drafts (0 differences, every branch reached).
import { describe, it, expect, afterEach } from "vitest";
import { draftForSave, draftRefusal, formSeatClash, kitchenAsk } from "../src/lib/booking-save.js";
import { setWeekHours, DEFAULT_WEEK_HOURS, KITCHEN_TABLE_LIMIT } from "../src/lib/constants.js";

// 2026-11-16 is a Monday. Monday closed, Friday closes at 01:00, Saturday at
// midnight, every other day 13:00 to 22:00.
const MON = "2026-11-16", TUE = "2026-11-17", FRI = "2026-11-20", SAT = "2026-11-21";
const WEEK = Object.assign({}, DEFAULT_WEEK_HOURS, {
  1: { open: 13, close: 22, closed: true },
  5: { open: 12, close: 25, closed: false },
  6: { open: 10, close: 24, closed: false },
});
const draft = (over) => Object.assign({ name: "Ana", phone: "", date: TUE, time: "19:00", size: 2, status: "confirmed" }, over);
const bk = (id, over) => Object.assign({ id, name: id, phone: "", date: TUE, time: "19:00", size: 2, duration: 90, status: "confirmed", tables: ["4"] }, over);
afterEach(() => setWeekHours(DEFAULT_WEEK_HOURS));

describe("draftForSave — the draft a save works on", () => {
  const P = ["ES", "GB"];
  it("hands the form back untouched when there is nothing to apply", () => {
    const f = draft({ phone: "+34 600 111 222" });
    expect(draftForSave(f, null, null, P, "+34")).toEqual({ draft: f, phoneRefusal: null });
    expect(draftForSave(f, null, null, P, "+34").draft).toBe(f);
  });
  it("puts a status override on a copy, never on the form", () => {
    const f = draft({ status: "pending" });
    const out = draftForSave(f, "confirmed", null, P, "+34");
    expect(out.draft.status).toBe("confirmed");
    expect(f.status).toBe("pending");
  });
});

describe("draftRefusal — the first field a save refuses", () => {
  it("passes a whole draft inside the day's hours", () => {
    expect(draftRefusal(draft(), null)).toBe(null);
  });
  it("asks in the form's order: name, phone, date, time", () => {
    const empty = draft({ name: " ", date: "", time: "" });
    expect(draftRefusal(empty, "No code.")).toEqual({ field: "name", message: "Customer name is required." });
    expect(draftRefusal(draft({ date: "", time: "" }), "No code.")).toEqual({ field: "phone", message: "No code." });
    expect(draftRefusal(draft({ date: "", time: "" }), null)).toEqual({ field: "date", message: "Please set a date." });
    expect(draftRefusal(draft({ time: "" }), null)).toEqual({ field: "time", message: "Please set a time." });
  });
  it("refuses a time that is there and cannot be read (CT-WA-01)", () => {
    // Measured on 2026-09-10: this value saved and showed as a 13:00 booking.
    expect(draftRefusal(draft({ time: "8 in the evening" }), null))
      .toEqual({ field: "time", message: "That time could not be read — please set it again." });
  });
  it("refuses a closed day, as the date's error", () => {
    setWeekHours(WEEK);
    expect(draftRefusal(draft({ date: MON }), null))
      .toEqual({ field: "date", message: "Closed on Mondays — pick another date, or open that day in Settings." });
  });
  it("refuses a start outside the day's own hours", () => {
    setWeekHours(WEEK);
    expect(draftRefusal(draft({ time: "12:30" }), null))
      .toEqual({ field: "time", message: "Bookings on this day are accepted between 13:00 and 22:00." });
    // Friday opens at 12 and closes at 01:00, printed as 01:00.
    expect(draftRefusal(draft({ date: FRI, time: "12:30" }), null)).toBe(null);
    expect(draftRefusal(draft({ date: FRI, time: "11:59" }), null).message)
      .toBe("Bookings on this day are accepted between 12:00 and 01:00.");
  });
  it("refuses a start after the last start, and names that minute", () => {
    setWeekHours(WEEK);
    expect(draftRefusal(draft({ time: "21:45" }), null)).toBe(null);
    expect(draftRefusal(draft({ time: "21:46" }), null)).toEqual({ field: "time", message: "The last start on Tuesdays is 21:45." });
    expect(draftRefusal(draft({ time: "22:00" }), null).message).toBe("The last start on Tuesdays is 21:45.");
  });
  it("keeps a last start on a day that closes at or after midnight", () => {
    // The old test (`sm >= close*60`) could not fire on a close of 24 or 25.
    setWeekHours(WEEK);
    expect(draftRefusal(draft({ date: SAT, time: "23:45" }), null)).toBe(null);
    expect(draftRefusal(draft({ date: SAT, time: "23:46" }), null).message).toBe("The last start on Saturdays is 23:45.");
    expect(draftRefusal(draft({ date: FRI, time: "23:59" }), null).message).toBe("The last start on Fridays is 23:45.");
  });
});

describe("formSeatClash — who is sitting where an edit seats its booking", () => {
  const day = [bk("mine"), bk("other", { status: "seated" }), bk("far", { status: "seated", tables: ["8"] })];
  it("names the seated party on the booking's own tables", () => {
    const out = formSeatClash(draft({ status: "seated" }), "mine", day);
    expect(out.map((p) => [p.booking.id, p.tables])).toEqual([["other", ["4"]]]);
  });
  it("reads the form's picked tables before the booking's own", () => {
    const out = formSeatClash(draft({ status: "seated", manualTables: ["8"] }), "mine", day);
    expect(out.map((p) => p.booking.id)).toEqual(["far"]);
  });
  it("asks nothing for a new booking, another status, or a booking already seated", () => {
    expect(formSeatClash(draft({ status: "seated" }), null, day)).toEqual([]);
    expect(formSeatClash(draft({ status: "confirmed" }), "mine", day)).toEqual([]);
    expect(formSeatClash(draft({ status: "seated" }), "other", day)).toEqual([]);
    expect(formSeatClash(draft({ status: "seated" }), "gone", day)).toEqual([]);
  });
  it("ignores a seated party on another date", () => {
    expect(formSeatClash(draft({ status: "seated", date: FRI }), "mine", day)).toEqual([]);
  });
});

describe("kitchenAsk — does this save raise \"Kitchen busy\"", () => {
  const busy = [];
  for (let i = 0; i < KITCHEN_TABLE_LIMIT - 1; i++) busy.push(bk("k" + i));
  it("asks when this booking's start would reach the limit", () => {
    expect(kitchenAsk(draft(), null, busy, null)).toBe(true);
    expect(kitchenAsk(draft(), null, busy.slice(1), null)).toBe(false);
    expect(kitchenAsk(draft({ time: "19:15" }), null, busy, null)).toBe(false);
  });
  it("does not ask about an edit the kitchen would not notice", () => {
    const mine = bk("mine", { originalDuration: 90 });
    const list = busy.concat([mine]);
    expect(kitchenAsk(draft({ notes: "window seat" }), mine, list, "mine")).toBe(false);
    // The same edit, moved into the busy slot from another time, is asked.
    const moved = bk("mine", { time: "20:00", originalDuration: 90 });
    expect(kitchenAsk(draft(), moved, busy.concat([moved]), "mine")).toBe(true);
  });
});
