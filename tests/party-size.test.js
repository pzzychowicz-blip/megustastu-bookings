// tests/party-size.test.js — v18.2.0, the design critique's C2: one word for a
// party's size. "4 guests", "1 guest"; "covers" stays the word for a day's
// total.
//
// Before: "4 pax" on twenty-one lines in fourteen files (Find a booking, the
// waitlist, the draft card, the table pickers, the Day sheet's "Pax" column…)
// beside the booking form's "Number of guests", the Settings tiers' "1–2
// guests" and every spoken label's "2 guests", with the plural typed out by
// hand ten more times — and a duration tier covering parties of one printed
// "1 guests".

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { guestsLabel, describeBooking, startingPhrase } from "../src/lib/booking-logic.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");
const sources = () => readdirSync(SRC, { recursive: true }).filter((f) => /\.jsx?$/.test(f));

describe("guestsLabel — the one word", () => {
  it("is singular for one and plural otherwise", () => {
    expect(guestsLabel(1)).toBe("1\u00a0guest");
    expect(guestsLabel(2)).toBe("2\u00a0guests");
    expect(guestsLabel(12)).toBe("12\u00a0guests");
    expect(guestsLabel(0)).toBe("0\u00a0guests");
  });

  it("reads a stored string the way it reads a number", () => {
    expect(guestsLabel("1")).toBe("1\u00a0guest");
    expect(guestsLabel("4")).toBe("4\u00a0guests");
  });

  it("is what the spoken labels and the forms' starting line say", () => {
    expect(describeBooking({ name: "Ana", time: "20:00", size: 1, tables: ["3"], status: "confirmed" }))
      .toContain("1\u00a0guest,");
    expect(startingPhrase({ starts: 1, guests: 1 })).toBe("1 booking · 1\u00a0guest");
    expect(startingPhrase({ starts: 2, guests: 6 })).toBe("2 bookings · 6\u00a0guests");
  });

  // v18.2.0 phase 54 (round 3's C-5): phase 45's no-break space, for the size.
  it("never lets a line break part the number from its word", () => {
    for (const n of [1, 2, 12]) {
      expect(guestsLabel(n)).not.toMatch(/ /);
      expect(guestsLabel(n)).toMatch(/^\d+\u00a0guests?$/);
    }
  });
});

describe("no surface says pax", () => {
  it("no source file prints the word, as a label or a column heading", () => {
    const hits = [];
    for (const f of sources()) {
      const src = read(f);
      if (/["'>]\s*pax\b|\bpax\s*["'<)]|>Pax</i.test(src)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });

  it("nothing types the plural out by hand — it is guestsLabel", () => {
    const hits = [];
    for (const f of sources()) {
      if (f === "lib/booking-logic.js") continue;
      const src = read(f);
      if (/" guest"\s*[:+]/.test(src)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });

  // Found live, not by a test: Settings' durations section had a LOCAL
  // `const guestsLabel = (n) => "≤ " + n` for its "Parties up to" stepper, which
  // shadowed the import across the whole component — the tiers line read
  // "≤ 1 → 90 min" and the size steppers "≤ 2". Build and lint both passed.
  it("no file defines a guestsLabel of its own, which would shadow the one word", () => {
    const hits = [];
    for (const f of sources()) {
      if (f === "lib/booking-logic.js") continue;
      if (/\b(const|let|var|function)\s+guestsLabel\b/.test(read(f))) hits.push(f);
    }
    expect(hits).toEqual([]);
    expect(read("components/Settings.jsx")).toMatch(/<HourStepper label="Parties up to" value=\{t\.max\} fmt=\{upToLabel\}/);
  });

  // v18.2.0 phase 43: two "(25)"s survived phase 38, because the sweep looked
  // for the word "pax" and these had no word at all — the waitlist ghost's
  // hover title and the Plan view's table popover ("Phase19 Test (2)").
  it("no source file puts a party's size in brackets", () => {
    const hits = [];
    for (const f of sources()) {
      if (/" \(" \+ \w+\.size \+ "\)/.test(read(f))) hits.push(f);
    }
    expect(hits).toEqual([]);
  });

  const sites = [
    ["components/SearchPanel.jsx", /\{guestsLabel\(b\.size\)\}/],
    ["components/PlanView.jsx", /\{b\.name\}<\/span>[\s{}]*<SizeRing n=\{b\.size\} rim="var\(--chip-neutral-border\)" \/>/],
    ["components/TimelineView.jsx", /title=\{"Waiting: " \+ g\.name \+ ", " \+ guestsLabel\(g\.size\) \+ ", at " \+ g\.time/],
    ["components/CustomersSettings.jsx", /\{guestsLabel\(b\.size\)\}/],
    ["components/WaitlistPanel.jsx", /\{guestsLabel\(w\.size\)\}/],
    ["components/WaitAvailBanner.jsx", /who \+ " · " \+ guestsLabel\(w\.size\) \+ " — table free"/],
    ["components/ManualModal.jsx", /" \(fits " \+ guestsLabel\(needed\) \+ "\)" : " — need " \+ guestsLabel\(needed\)/],
    ["components/WalkinForm.jsx", /" \(fits " \+ guestsLabel\(wSize\) \+ "\)" : " — need " \+ guestsLabel\(wSize\)/],
    ["components/PrefPickerModal.jsx", /"Capacity: " \+ cap \+ " \/ " \+ guestsLabel\(needed\)/],
    ["components/Settings.jsx", /\(r\.name \|\| "\(no name\)"\) \+ " · " \+ guestsLabel\(r\.size\)/],
    ["components/DaySheet.jsx", /<th style=\{th\}>Guests<\/th>/],
    // v18.2.0 phase 49: "Past bookings" rows no longer end in their status
    // (always "completed"); the no-show list keeps it.
    ["components/BookingFormModal.jsx", /" · "\+guestsLabel\(b\.size\)\+\(noshow\?" · "\+b\.status:""\)/],
    ["components/whatsapp/ConversationView.jsx", /" · " \+ guestsLabel\(b\.size\)\}<\/AlertRow>/],
    ["components/whatsapp/IntentBanner.jsx", /reqParts\.push\(guestsLabel\(draftData\.size\)\)/],
  ];
  for (const [file, re] of sites) {
    it(file, () => { expect(read(file)).toMatch(re); });
  }

  it("the draft card says '? guests' for a size it has not got", () => {
    expect((read("components/whatsapp/DraftCard.jsx").match(/\(d\.size != null \? guestsLabel\(d\.size\) : "\? guests"\)/g) || []).length).toBe(2);
  });

  // A tier covering parties of one printed "1 guests → 60 min".
  it("a one-size duration tier takes guestsLabel, a range stays plural", () => {
    expect(read("components/Settings.jsx")).toMatch(/=== t\.max \? guestsLabel\(t\.max\) : \(i > 0 \? tiers\[i - 1\]\.max \+ 1 : 1\) \+ "–" \+ t\.max \+ " guests"\) \+ " → "/);
    // …and the catch-all tier after them says what it counts: "6+ guests".
    expect(read("components/Settings.jsx")).toMatch(/restFrom \+ "\+ guests → " \+ bd\.restDur \+ " min"/);
  });
});

describe("covers stays the word for a day's total", () => {
  it("the Summary, the Month view and the Day sheet count covers", () => {
    expect(read("components/Summary.jsx")).toMatch(/" cover" \+ \(/);
    expect(read("components/WeekView.jsx")).toMatch(/r\.covers \+ " cover"/);
    expect(read("components/DaySheet.jsx")).toMatch(/s\.totalCovers \+ " cover"/);
  });
});
