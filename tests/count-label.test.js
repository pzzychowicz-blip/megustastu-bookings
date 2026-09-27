// tests/count-label.test.js — v18.2.0 phase 77 (round 3's loose end): a count
// and its word are joined by a no-break space, so no line ends on the number.
// Phase 54 joined `formatDay` and `guestsLabel`; every other count ("2
// bookings", "20 min late", "3 visits", "12 months") was typed at its own site
// with a plain space. `countLabel` (booking-logic.js) is the one way to print
// one, and the sweep below fails on a count typed the old way.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { countLabel, guestsLabel, startingPhrase } from "../src/lib/booking-logic.js";

describe("countLabel", () => {
  it("joins the count and the word with a no-break space, and inflects", () => {
    expect(countLabel(1, "booking", "bookings")).toBe("1 booking");
    expect(countLabel(2, "booking", "bookings")).toBe("2 bookings");
    expect(countLabel(0, "visit", "visits")).toBe("0 visits");
    expect(countLabel("1", "visit", "visits"), "a count read from a string is still one").toBe("1 visit");
  });
  it("a unit that does not inflect passes one word", () => {
    expect(countLabel(1, "min")).toBe("1 min");
    expect(countLabel(20, "min")).toBe("20 min");
  });
  it("guestsLabel is countLabel, so the two cannot drift", () => {
    [1, 2, 11].forEach((n) => expect(guestsLabel(n)).toBe(countLabel(n, "guest", "guests")));
    expect(startingPhrase({ starts: 3, guests: 9 })).toBe("3 bookings · 9 guests");
  });
});

// The words a count is written with.
const WORDS = "min|mins|minutes|booking|bookings|cover|covers|visit|visits|no-show|no-shows|reminder|reminders|month|months|year|years|chair|chairs|waiting|day|days|table|tables|seat|seats|message|messages|total|more|guest|guests|entries|entry|waitlist entr|row|rows|conversation|conversations|selected|earlier";
// A count WORD concatenated with a plain space: `n + " bookings"`, `+ " min"`.
const COUNT_WORD = new RegExp('\\+ ?" (' + WORDS + ')\\b', "g");
// …and the same word as the branch of a plural ternary: `n + (n === 1 ? " entry" : " entries")`.
// v18.2.0 /code-review: the sweep matched only the shape above, so five
// on-screen counts written this way (the List's "Completed & cancelled"
// summary, "Collapse banners above", the Activity log's entry count, its clear
// toast, the day announcement) kept a plain space and this test passed over
// every one. One match per ternary: the `: " entries"` branch has no `?`.
const COUNT_TERNARY = new RegExp('\\? ?" (' + WORDS + ')\\b', "g");

// The sites that keep a plain space on purpose, counted, so a new one fails.
const ALLOWED = {
  // Two entries in a booking's stored `history` ("length 90 → 120 min") and one
  // naming a visit by its date: records, not screen text.
  "App.jsx": 3,
  // "Carried from the Fri 25.09 visit": a date before the word, not a count.
  "components/BookingFormModal.jsx": 1,
  // A console line.
  "hooks/usePersistence.js": 1,
  // "N bookings re-placed" and "cleared the activity log · … · N entries":
  // the text of STORED activity entries.
  "lib/activity.js": 2,
};

describe("the guard sees both shapes", () => {
  it("a plain concatenation and a plural ternary", () => {
    expect('n + " bookings"'.match(COUNT_WORD)).toHaveLength(1);
    expect('n + (n === 1 ? " booking" : " bookings")'.match(COUNT_TERNARY)).toHaveLength(1);
    expect('(t.length>1?"tables ":"table ")'.match(COUNT_TERNARY), "a word with no count before it").toBeNull();
  });
});

describe("no count is typed with a plain space", () => {
  it("every count-word concatenation in src is countLabel's, bar the listed records", () => {
    const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
    const hits = {};
    (function walk(dir) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|jsx)$/.test(e.name)) {
          const src = stripComments(readFileSync(p, "utf8")).join("\n");
          const n = (src.match(COUNT_WORD) || []).length + (src.match(COUNT_TERNARY) || []).length;
          if (n) hits[p.slice(SRC.length + 1)] = n;
        }
      }
    })(SRC);
    expect(hits).toEqual(ALLOWED);
  });
});
