// tests/phone-format.test.js — v18.2.0 phase 50, round 3's C-4: one way a
// phone is shown, `formatPhone` (lib/customers.js), at the real calling code.
//
// Measured on DEV before: one List screen printed the stored text in three
// shapes ("+34 612 345 678", "+44 33 6 12 34 56 78", "+34655443322"), the Day
// sheet likewise, while the waitlist, Customers, Find a booking and WhatsApp
// printed formatPhone's — which split after two digits whatever the code
// ("+1 212 555 0123" read "+12 125550123"). formatPhone's own cases are in
// tests/customers.test.js.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => stripComments(readFileSync(join(SRC, rel), "utf8")).join("\n");

describe("every phone on screen goes through formatPhone", () => {
  it("the List card, and the Day sheet's bookings and waitlist", () => {
    expect(read("components/ListView.jsx")).toMatch(/\{formatPhone\(b\.phone\)\}<\/span>/);
    expect(read("components/DaySheet.jsx")).toMatch(/\{b\.phone \? formatPhone\(b\.phone\) : "—"\}/);
    expect(read("components/DaySheet.jsx")).toMatch(/\(w\.phone \? " · " \+ formatPhone\(w\.phone\) : ""\)/);
  });

  // The shapes the three had: a stored phone as a JSX child, or concatenated
  // into a line. An ATTRIBUTE (`key={c.phone}`, an input's `value=`) is not
  // text on screen, hence the lookbehind. The simulator's own form is dev-only.
  it("no component prints a stored phone raw", () => {
    const hits = [];
    for (const f of readdirSync(join(SRC, "components"), { recursive: true })) {
      if (!/\.jsx$/.test(f) || /WaSimulator/.test(f)) continue;
      const src = read("components/" + f);
      if (/(?<!=)\{\s*\w+\.phone\s*(\|\||\})|\+\s*\w\.phone\b/.test(src)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });

  it("finds the code in the country picker's own table", () => {
    const Cust = read("lib/customers.js");
    expect(Cust).toMatch(/import \{ dialOf \} from "\.\/phone-countries\.js";/);
    expect(Cust).toMatch(/const dial = dialOf\(n\);\s*return dial \? "\+" \+ dial \+ " " \+ n\.slice\(1 \+ dial\.length\) : n;/);
  });
});
