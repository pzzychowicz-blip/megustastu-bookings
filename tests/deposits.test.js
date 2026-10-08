// tests/deposits.test.js — v18.5.0, the day's deposits line.
//
// `depositSummary` decides which side of the line a deposit is on, and
// `depositParts` / `depositLine` are the words the Summary panel and the
// printed day sheet show. Staff read the line as money the restaurant holds, so
// the split is tested case by case; the last group reads the two components to
// hold them to the ONE derivation.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { depositSummary, depositParts, depositLine, daySummary } from "../src/lib/booking-logic.js";
import { stripComments } from "../scripts/strip-comments.mjs";

const D = "2026-10-08";
const NB = " "; // `money` and `countLabel` join a number and its word with a no-break space
const bk = (id, status, deposit, extra) => Object.assign(
  { id, date: D, time: "19:00", size: 2, status, deposit, tables: ["3"] }, extra || {});

describe("depositSummary — which side a deposit is on", () => {
  it("a day with no deposit has nothing to show", () => {
    const s = depositSummary([bk("a", "confirmed", 0), bk("b", "cancelled", 0)], D);
    expect(s).toEqual({ held: { total: 0, count: 0 }, forfeited: { total: 0, count: 0 }, any: false });
  });

  it("holds a deposit on every status that still stands", () => {
    const s = depositSummary([
      bk("p", "pending", 10), bk("c", "confirmed", 20), bk("s", "seated", 30), bk("d", "completed", 40),
    ], D);
    expect(s.held).toEqual({ total: 100, count: 4 });
    expect(s.forfeited).toEqual({ total: 0, count: 0 });
    expect(s.any).toBe(true);
  });

  it("counts a cancelled booking's deposit as forfeited, a no-show included", () => {
    const s = depositSummary([
      bk("x", "cancelled", 25), bk("n", "cancelled", 15, { noShow: true }), bk("c", "confirmed", 20),
    ], D);
    expect(s.forfeited).toEqual({ total: 40, count: 2 });
    expect(s.held).toEqual({ total: 20, count: 1 });
  });

  it("reads only the asked date", () => {
    const s = depositSummary([bk("a", "confirmed", 20), bk("b", "confirmed", 50, { date: "2026-10-09" })], D);
    expect(s.held).toEqual({ total: 20, count: 1 });
  });

  it("takes a deposit stored as text, and ignores what is not an amount", () => {
    const s = depositSummary([
      bk("t", "confirmed", "20"), bk("z", "confirmed", ""), bk("u", "confirmed", undefined),
      bk("g", "confirmed", "abc"), bk("m", "confirmed", -5), null,
    ], D);
    expect(s.held).toEqual({ total: 20, count: 1 });
  });

  it("keeps an anonymised booking's deposit: the money was still taken", () => {
    const s = depositSummary([bk("a", "completed", 30, { name: "Data removed", anonymized: true })], D);
    expect(s.held).toEqual({ total: 30, count: 1 });
  });

  it("survives a missing list", () => {
    expect(depositSummary(undefined, D).any).toBe(false);
    expect(depositSummary(null, D).any).toBe(false);
  });

  it("sees the cancelled bookings daySummary drops", () => {
    // The reason this is its own function: on a day whose only booking was
    // cancelled, the Summary says "No bookings" and the deposit is still there.
    const list = [bk("x", "cancelled", 25)];
    expect(daySummary(list, D, 17).totalBookings).toBe(0);
    expect(depositSummary(list, D).forfeited).toEqual({ total: 25, count: 1 });
  });
});

describe("depositParts and depositLine — the words", () => {
  const both = depositSummary([
    bk("a", "confirmed", 50), bk("b", "seated", 50), bk("c", "completed", 50), bk("x", "cancelled", 40),
  ], D);

  it("says both sides, held first", () => {
    expect(depositLine(both, "€")).toBe(
      "Deposits · 150" + NB + "€ held (3" + NB + "bookings) · 40" + NB + "€ forfeited (1" + NB + "booking)");
  });

  it("leaves out a side with nothing", () => {
    const held = depositSummary([bk("a", "confirmed", 20)], D);
    expect(depositLine(held, "€")).toBe("Deposits · 20" + NB + "€ held (1" + NB + "booking)");
    const lost = depositSummary([bk("x", "cancelled", 20), bk("y", "cancelled", 5)], D);
    expect(depositLine(lost, "€")).toBe("Deposits · 25" + NB + "€ forfeited (2" + NB + "bookings)");
  });

  it("is empty on a day with no deposit, so nothing is drawn", () => {
    const none = depositSummary([bk("a", "confirmed", 0)], D);
    expect(depositParts(none, "€")).toEqual([]);
    expect(depositLine(none, "€")).toBe("");
    expect(depositParts(undefined, "€")).toEqual([]);
  });

  it("prints the configured currency and rounds to cents", () => {
    const s = depositSummary([bk("a", "confirmed", 10.1), bk("b", "confirmed", 20.2)], D);
    expect(depositParts(s, "zł")[0].amount).toBe("30.3" + NB + "zł");
  });

  it("the line is the parts joined: the screen and the paper cannot disagree", () => {
    const parts = depositParts(both, "€");
    expect(parts.map((p) => p.key)).toEqual(["held", "forfeited"]);
    expect(depositLine(both, "€")).toBe(
      "Deposits · " + parts.map((p) => p.amount + " " + p.word + " (" + p.count + ")").join(" · "));
  });
});

describe("the two surfaces read the one derivation", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  // `stripComments` answers line by line.
  const src = (rel) => stripComments(readFileSync(join(root, rel), "utf8")).join("\n");
  const summary = src("src/components/Summary.jsx");
  const sheet = src("src/components/DaySheet.jsx");
  const app = src("src/App.jsx");

  it("the Summary panel draws depositParts of depositSummary, for the viewed date", () => {
    expect(summary).toMatch(/depositSummary\(bookings, date\)/);
    expect(summary).toMatch(/depositParts\(dep, currency \|\| "€"\)/);
  });

  it("the day sheet prints depositLine of depositSummary, from ALL the date's bookings", () => {
    // Not from `day`, the table's list, which has no cancelled bookings in it.
    expect(sheet).toMatch(/depositLine\(depositSummary\(bookings, date\), currency \|\| "€"\)/);
    expect(sheet).not.toMatch(/depositSummary\(day\b/);
  });

  it("neither surface adds deposits up by itself", () => {
    for (const text of [summary, sheet]) {
      expect(text).not.toMatch(/forfeited/);
      expect(text).not.toMatch(/\bheld\b/);
    }
  });

  it("App hands the Summary the restaurant's currency", () => {
    const mount = app.slice(app.indexOf("const summaryPanel=<Summary"));
    expect(mount.slice(0, mount.indexOf("/>"))).toMatch(/currency=\{generalSettings\.currency\}/);
  });
});
