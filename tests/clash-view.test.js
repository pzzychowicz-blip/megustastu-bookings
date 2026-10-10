// tests/clash-view.test.js — v18.6.0 (ROADMAP #17): what the screen draws from
// a day's double-bookings, moved out of three memos in BookingApp. Held to the
// old memo bodies over 40,000 generated days before the swap (REFACTOR_LOG).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../scripts/strip-comments.mjs";
import { clashRowId } from "../src/lib/booking-logic.js";
import { undismissedClashes, clashByBooking, clashSpansByTable } from "../src/lib/clash-view.js";

const pair = (a, b, tables, from, to) => ({ a, b, tables, from, to });
const P1 = pair("x", "y", ["4"], 1200, 1260);
const P2 = pair("y", "z", ["4", "5"], 1230, 1290);
const P3 = pair("x", "z", [], 1200, 1230);          // the join-cluster case: no shared table
const BOOKINGS = [{ id: "x", name: "Pau" }, { id: "y", name: "Rita" }, { id: "z", name: "Pau" }];

describe("undismissedClashes", () => {
  it("is the same array when nothing is dismissed", () => {
    const pairs = [P1, P2];
    expect(undismissedClashes(pairs, new Set())).toBe(pairs);
    expect(undismissedClashes(pairs, null)).toBe(pairs);
  });
  it("drops a dismissed PAIR and keeps the others of the same booking", () => {
    expect(undismissedClashes([P1, P2], new Set([clashRowId(P1)]))).toEqual([P2]);
    expect(undismissedClashes([P1, P2], new Set(["a row that is gone"]))).toEqual([P1, P2]);
  });
});

describe("clashByBooking", () => {
  it("names each other party once and lists each shared table once", () => {
    const m = clashByBooking([P1, P2, P3], BOOKINGS);
    expect(m.y).toEqual({ names: ["Pau"], tables: ["4", "5"] });   // x and z are both "Pau"
    expect(m.x).toEqual({ names: ["Rita", "Pau"], tables: ["4"] });
    expect(m.z).toEqual({ names: ["Rita", "Pau"], tables: ["4", "5"] });
  });
  it("skips a pair naming a booking that is no longer in the list", () => {
    expect(clashByBooking([P1], [{ id: "x", name: "Pau" }])).toEqual({});
    expect(clashByBooking([], BOOKINGS)).toEqual({});
  });
});

describe("clashSpansByTable", () => {
  it("merges the spans of one table and gives a pair with no shared table no band", () => {
    const s = clashSpansByTable([P1, P2, P3]);
    expect(s["4"]).toEqual([{ from: 1200, to: 1290 }]);
    expect(s["5"]).toEqual([{ from: 1230, to: 1290 }]);
    expect(Object.keys(s).sort()).toEqual(["4", "5"]);
  });
  it("keeps separate spans separate", () => {
    expect(clashSpansByTable([pair("a", "b", ["3"], 780, 840), pair("c", "d", ["3"], 1200, 1260)])["3"])
      .toEqual([{ from: 780, to: 840 }, { from: 1200, to: 1260 }]);
  });
});

describe("the wiring", () => {
  const APP = stripComments(readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8")).join("\n");
  it("App keeps the memos and the EMPTY identities its memoised views compare", () => {
    expect(APP).toContain("return clashPairs.length?undismissedClashes(clashPairs,clashDismissed):EMPTY_ARR;");
    expect(APP).toContain("return clashPairs.length?clashByBooking(clashPairs,bookings):EMPTY_OBJ;");
    expect(APP).toContain("return clashPairs.length?clashSpansByTable(clashPairs):EMPTY_OBJ;");
  });
});
